export interface SendParams {
    messageId: string;
    to: string;
    body: string;
}

export interface SendResult {
    gatewayGuid: string;
}

export interface MessageSender {
    send(params: SendParams): Promise<SendResult>;
}