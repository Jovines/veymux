import { renewBackgroundSubscriptions, reportBackgroundNotificationClick, flushBackgroundNotificationLogs } from './backgroundNotifications';
Object.assign(globalThis, { veymuxBackground: { renewSubscriptions: renewBackgroundSubscriptions, reportClick: reportBackgroundNotificationClick, flushLogs: flushBackgroundNotificationLogs } });
