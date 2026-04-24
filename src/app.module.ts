import { Module } from "@nestjs/common";
import { OrderModule } from "./order/order.module";
import { RedisModule } from "./redis/redis.module";

@Module({
  imports: [
    RedisModule, // Global — provides RedisService everywhere
    OrderModule,
  ],
})
export class AppModule {}
