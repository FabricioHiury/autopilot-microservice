import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { matchesSecret } from './delivery.utils';
@WebSocketGateway({
  namespace: '/crm',
  transports: ['websocket'],
  maxHttpBufferSize: 10 * 1024 * 1024,
})
export class CrmGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly clients = new Map<string, Socket>();
  handleConnection(socket: Socket) {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers['x-micro-token'] ||
      socket.handshake.headers['x-api-key'];
    if (!matchesSecret(token, process.env.MICROSERVICE_TOKEN)) {
      socket.disconnect(true);
      return;
    }
    this.clients.set(socket.id, socket);
  }
  handleDisconnect(socket: Socket) {
    this.clients.delete(socket.id);
  }
  async deliver(event: string, payload: any): Promise<boolean> {
    const socket = [...this.clients.values()].find(
      (client) => client.connected,
    );
    if (!socket) return false;
    try {
      const ack = await socket.timeout(5000).emitWithAck(event, payload);
      return (
        ack?.accepted === true &&
        (!payload.eventId || ack.eventId === payload.eventId)
      );
    } catch {
      return false;
    }
  }
}
