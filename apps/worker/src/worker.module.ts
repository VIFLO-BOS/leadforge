import { Module, type DynamicModule } from "@nestjs/common";
import { CoreModule } from "@leadforge/core";
import { WorkerRuntime } from "./worker.runtime.js";
import { MailProcessor } from "./processors/mail.processor.js";

@Module({})
export class WorkerModule {
  static forRoot(envSource: NodeJS.ProcessEnv = process.env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(envSource)],
      providers: [MailProcessor, WorkerRuntime],
    };
  }
}
