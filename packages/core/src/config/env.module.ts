import { Global, Inject, Module, type DynamicModule } from "@nestjs/common";
import { parseServerEnv, type ServerEnv } from "@leadforge/contracts";

export const ENV = Symbol("ENV");

/** Inject the validated server environment. */
export const InjectEnv = (): ParameterDecorator => Inject(ENV);

@Global()
@Module({})
export class EnvModule {
  /** Parses process.env once at boot. Throws on invalid configuration. */
  static forRoot(source: NodeJS.ProcessEnv = process.env): DynamicModule {
    const env: ServerEnv = parseServerEnv(source);
    return {
      module: EnvModule,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
