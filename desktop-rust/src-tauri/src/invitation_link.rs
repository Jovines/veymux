//! Untrusted browser handoff. Parse only an invitation; TLS and target authority
//! remain with the existing connection center and authenticated service.
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use url::Url;
use crate::config::{origin, Connection};

#[derive(Serialize)]
pub struct InvitationReview { pub connection: Connection, pub invitation: String }

pub fn parse_deep_invitation(value: &str, preview: bool) -> Result<InvitationReview, String> {
    let fail = || "邀请链接无效，请重新复制完整链接。".to_owned();
    if value.len() > 12000 { return Err(fail()); }
    let link = Url::parse(value).map_err(|_| fail())?;
    let scheme = if preview { "termdock-preview" } else { "termdock" };
    if link.scheme()!=scheme || link.host_str()!=Some("invite") || !["", "/"].contains(&link.path())
        || link.query().is_some() || link.port().is_some() || !link.username().is_empty() || link.password().is_some() { return Err(fail()); }
    let encoded = link.fragment().and_then(|f|f.strip_prefix("termdock-invite=")).ok_or_else(fail)?;
    if encoded.len() > 8192 { return Err(fail()); }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded).map_err(|_|fail())?;
    let mut data: Value = serde_json::from_slice(&bytes).map_err(|_|fail())?;
    let descriptor = data.as_object().ok_or_else(fail)?;
    let target = descriptor.get("serviceId").and_then(Value::as_str).ok_or_else(fail)?.to_owned();
    let entry = origin(descriptor.get("entryUrl").and_then(Value::as_str).ok_or_else(fail)?)?;
    let entry_url = Url::parse(&entry).map_err(|_|fail())?;
    if entry_url.scheme()!="https" { return Err("客户端邀请需要原始 HTTPS 服务地址，请更新分享方后重新生成链接。".into()); }
    let optional_text = |key: &str| -> Result<Option<String>,String> {
        descriptor.get(key).map(|v|v.as_str().map(str::to_owned).ok_or_else(fail)).transpose()
    };
    let entry_id = optional_text("entryServiceId")?;
    let service = optional_text("serviceUrl")?.map(|v|origin(&v)).transpose()?.unwrap_or_else(||entry.clone());
    let service = if entry_id.as_ref().is_some_and(|id|id!=&target) { service } else { entry.clone() };
    let label = optional_text("name")?.unwrap_or_else(||entry_url.host_str().unwrap_or("共享会话").to_owned());
    if descriptor.get("viewMode").is_some_and(|v|v.as_str()!=Some("chat") && v.as_str()!=Some("terminal"))
        || descriptor.get("viewLayout").is_some_and(|v|v.as_str()!=Some("split")) { return Err(fail()); }
    let connection = Connection { id:target.clone(), url:entry.clone(), label, target_peer_id:Some(target),
        service_origin:Some(service.clone()), entry_service_id:entry_id, routes:vec![] }.validated()?;
    data["entryUrl"] = Value::String(entry.clone());
    data["serviceUrl"] = Value::String(service);
    let fragment = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&data).map_err(|_|fail())?);
    let invitation = format!("{entry}/#termdock-invite={fragment}");
    connection.validate_invitation(&invitation)?;
    Ok(InvitationReview { connection, invitation })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn descriptor() -> Value { serde_json::json!({"v":1,"serviceId":format!("12D3KooW{}","a".repeat(44)),"entryUrl":"https://entry.example:9834","code":"c".repeat(43),"name":"共享构建会话","viewMode":"chat"}) }
    fn link(value: &Value) -> String { format!("termdock://invite/#termdock-invite={}",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(value).unwrap())) }
    #[test]
    fn opens_a_pinned_invitation_without_persisting_credentials_in_the_bookmark() {
        let value=descriptor();let review=parse_deep_invitation(&link(&value),false).unwrap();
        assert_eq!(review.connection.url,"https://entry.example:9834");
        assert_eq!(review.connection.label,"共享构建会话");
        assert!(!serde_json::to_string(&review.connection).unwrap().contains(&"c".repeat(43)));
        assert!(!serde_json::to_string(&review.connection).unwrap().contains("service:*"));
        review.connection.validate_invitation(&review.invitation).unwrap();
        assert!(parse_deep_invitation(&link(&value),true).is_err());
    }
    #[test]
    fn retains_independent_entry_and_target_pins_and_view_layout() {
        let mut value=descriptor();value["entryServiceId"]=serde_json::json!(format!("12D3KooW{}","b".repeat(44)));
        value["routeCode"]=serde_json::json!("r".repeat(43));value["serviceUrl"]=serde_json::json!("https://target.internal");value["viewLayout"]=serde_json::json!("split");
        let review=parse_deep_invitation(&link(&value),false).unwrap();
        assert_eq!(review.connection.service_origin.as_deref(),Some("https://target.internal"));
        assert_ne!(review.connection.entry_service_id,review.connection.target_peer_id);
    }
    #[test]
    fn rejects_malformed_or_overbroad_uri_shapes_before_discovery() {
        let good=link(&descriptor());
        for value in [good.replace("termdock:","https:"),good.replace("invite/","attacker/"),good.replace("invite/","user@invite/"),good.replace("/#","/?secret=x#"),format!("termdock://invite/#termdock-invite={}","a".repeat(8193))] { assert!(parse_deep_invitation(&value,false).is_err()); }
        for (key,value) in [("entryUrl",serde_json::json!("http://entry.example")),("serviceId",serde_json::json!("forged")),("code",serde_json::json!("bad")),("name",serde_json::json!("bad\nname")),("viewMode",serde_json::json!("shell"))] {
            let mut invalid=descriptor();invalid[key]=value;assert!(parse_deep_invitation(&link(&invalid),false).is_err());
        }
    }
}
