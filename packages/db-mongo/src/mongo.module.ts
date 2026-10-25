import { Global, Module, type DynamicModule } from "@nestjs/common";
import { MONGO_OPTIONS, MongoService, type MongoOptions } from "./mongo.service.js";

@Global()
@Module({})
export class MongoModule {
  static forRoot(options: MongoOptions): DynamicModule {
    return {
      module: MongoModule,
      providers: [{ provide: MONGO_OPTIONS, useValue: options }, MongoService],
      exports: [MongoService],
    };
  }
}
