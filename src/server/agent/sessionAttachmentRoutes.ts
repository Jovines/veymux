import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { encryptedRequestResources, encryptedRequestSubject, hasEncryptedServiceAccess } from '../federation/requestContext.js';
import { androidRecordings } from '../android/recording.js';
import { androidRouteAccess } from '../shared/androidDevices.js';
import { handleFileUpload } from '../routes/filesystem.js';
import { sessionAttachmentRoot } from '../federation/sessionAttachmentAccess.js';

/** A Session input capability may add new attachments, never choose a server path. */
export function sessionAttachmentRoutes(directory: string, resolve: (id: string) => string | null | undefined) {
  const router = Router();
  router.post('/:sessionId/chat/attachments/recording', async (req, res) => {
    const subject = encryptedRequestSubject(req), session = subject && resolve(req.params.sessionId);
    if (!session) { res.status(404).json({ error: '会话不可用' }); return; }
    if (typeof req.body?.recordingId !== 'string' || Object.keys(req.body).some(key => key !== 'recordingId') || Object.keys(req.query).length) {
      res.status(400).json({ error: '录像附件只能指定录像 ID' }); return;
    }
    const owner = hasEncryptedServiceAccess(req) ? undefined : subject;
    try {
      const recording = await androidRecordings.info(req.body.recordingId, owner);
      if (!hasEncryptedServiceAccess(req) && !androidRouteAccess(encryptedRequestResources(req)?.android, recording.serial)) {
        res.status(403).json({ error: '此手机录像未获授权' }); return;
      }
      const root = sessionAttachmentRoot(directory, session);
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      if (await fs.realpath(root) !== root) throw new Error('附件目录不可用');
      // A separate directory also makes retries deterministic and prevents a
      // recipient from choosing or overwriting any server filesystem path.
      const destination = path.join(root, `recording-${recording.id}`);
      await fs.mkdir(destination, { recursive: true, mode: 0o700 });
      if (await fs.realpath(destination) !== destination) throw new Error('附件目录不可用');
      res.json({ path: await androidRecordings.save(recording.id, destination, owner) });
    } catch { if (!res.headersSent) res.status(400).json({ error: '录像附件保存失败，请重试' }); }
  });
  router.post('/:sessionId/chat/attachments', async (req, res) => {
    const subject = encryptedRequestSubject(req), session = subject && resolve(req.params.sessionId);
    if (!session) { res.status(404).json({ error: '会话不可用' }); return; }
    if (Object.keys(req.query).some(key => key !== 'fileCount')) { res.status(400).json({ error: '附件不能指定服务端保存目录' }); return; }
    let destination: string | undefined;
    try {
      const root = sessionAttachmentRoot(directory, session);
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      if (await fs.realpath(root) !== root) throw new Error('附件目录不可用');
      destination = await fs.mkdtemp(path.join(root, 'upload-'));
      await handleFileUpload(req, res, destination);
    } catch { if (!res.headersSent && !res.destroyed) res.status(500).json({ error: '附件上传失败，请重试' }); }
    finally { if (destination) await fs.rmdir(destination).catch(() => {}); }
  });
  return router;
}
