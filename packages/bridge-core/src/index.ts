// API công khai của @trcf/bridge-core, dùng chung cho các service zalo-personal và zalo-oa.
export type { ChannelCard } from "./admin/channel-card-script.js";
export type { AdminUi } from "./admin/page.js";
export { KeyedQueue } from "./bridge/keyed-queue.js";
export { registerChannel } from "./channels/register.js";
export type {
  ChannelConnector,
  ChannelState,
  ConnectSessions,
  ConnectSessionView,
  InboundMessage,
  OnInboundMessage,
} from "./channels/types.js";
export { ChatwootClient, ChatwootError } from "./chatwoot/client.js";
export { chatwootPublicUrl, config, parseEnv } from "./config.js";
export { logger, type Logger } from "./logger.js";
export { decryptJson, encryptJson } from "./store/crypto.js";
export { deleteChannel, getChannel, listChannels, saveCredentials, setChannelStatus } from "./store/repo.js";
export { channelKey, type Channel, type ChannelKind, type ChannelStatus, type Thread } from "./store/schema.js";
export { runBridge, type BridgeContext } from "./run.js";
