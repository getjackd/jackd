/// <reference types="node" />
import { Socket } from 'net';
import { CommandExecution, CommandHandler, ConnectOpts, Job, CtorOpts, PutOpts } from './types';
export declare class JackdClient {
    socket: Socket;
    connected: Boolean;
    buffer: Buffer;
    incomingBytes: number;
    useLegacyStringPayloads: boolean;
    messages: Buffer[];
    executions: CommandExecution[];
    processChunk(head: Buffer): Promise<void>;
    constructor(opts?: CtorOpts);
    flushExecutions(): Promise<void>;
    isConnected(): Boolean;
    connect(opts?: ConnectOpts): Promise<this>;
    write(buffer: Buffer): Promise<void>;
    quit(): Promise<void>;
    close: () => Promise<void>;
    disconnect: () => Promise<void>;
    executeCommand: (...args: any[]) => Promise<any>;
    use: (tubeId: string) => Promise<string>;
    put: (payload: string | object | Buffer, options?: PutOpts) => Promise<Buffer>;
    delete: (jobId: string) => Promise<void>;
    createReserveHandlers(): CommandHandler[];
    reserve: () => Promise<Job>;
    reserveWithTimeout: () => Promise<Job>;
    watch: (tubeId: string) => Promise<number>;
    ignore: (tubeId: string) => Promise<number>;
    bury: (jobId: string) => Promise<void>;
    peekBuried: () => Promise<Job>;
    executeMultiPartCommand: (command: string) => Promise<string>;
    pauseTube: (tubeId: string, options?: import("./types").PauseTubeOpts) => Promise<void>;
    release: (jobId: string, options?: import("./types").ReleaseOpts) => Promise<void>;
    touch: (jobId: string) => Promise<void>;
    peek: (jobId: string) => Promise<Job>;
    kick: (jobsCount: number) => Promise<void>;
    kickJob: (jobId: string) => Promise<void>;
    getCurrentTube: () => Promise<string>;
    createCommandHandler<TArgs extends any[], TReturn>(commandStringFunction: (...args: any[]) => Buffer, handlers: CommandHandler[]): (...args: TArgs) => Promise<TReturn>;
}
export declare class InvalidResponseError extends Error {
    response: string;
}
//# sourceMappingURL=index.d.ts.map