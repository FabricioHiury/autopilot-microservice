import { Global, Module } from '@nestjs/common';
import { DurableQueueService } from './durable-queue.service';
import { CrmGateway } from './crm.gateway';
import { EventDeliveryService } from './event-delivery.service';
@Global()
@Module({
  providers: [DurableQueueService, CrmGateway, EventDeliveryService],
  exports: [DurableQueueService, EventDeliveryService],
})
export class DeliveryModule {}
