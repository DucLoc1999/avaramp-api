export interface WebhookPayload {
  order_id: string;
  old_order_state: number;
  new_order_state: number;
  old_order_processing_state?: number;
  new_order_processing_state?: number;
  transaction_hash?: string | null;
}

export interface WebhookEvent {
  id: string;
  topic: 'order.state_changed';
  ts: string;
  payload: WebhookPayload;
}
