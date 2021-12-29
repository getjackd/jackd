/// <reference types="node" />
import EventEmitter = require('events');
export declare type CommandHandler<T> = (chunk: Buffer) => Promise<T>;
export declare class CommandExecution<T> {
    handlers: CommandHandler<T | void>[];
    emitter: EventEmitter;
}
export interface CtorOpts {
    useLegacyStringPayloads: boolean;
}
export interface ConnectOpts {
    host: string;
    port?: number;
}
export interface PutOpts {
    delay?: number;
    priority?: number;
    ttr?: number;
}
export interface Job {
    id: string;
    payload: Buffer | string;
}
export interface ReleaseOpts {
    priority?: number;
    delay?: number;
}
export interface PauseTubeOpts {
    delay?: number;
}
export declare type PutArgs = [payload: Buffer | string | object, options?: PutOpts];
export declare type ReleaseArgs = [jobId: string, options?: ReleaseOpts];
export declare type PauseTubeArgs = [tubeId: string, options?: PauseTubeOpts];
export declare type JobArgs = [jobId: string];
export declare type TubeArgs = [tubeId: string];
//# sourceMappingURL=types.d.ts.map