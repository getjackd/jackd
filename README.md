# jackd

![Tests](https://github.com/getjackd/jackd/actions/workflows/test.yml/badge.svg)

Modern beanstalkd client for Node.js.

```js
const Jackd = require("jackd")
const beanstalkd = new Jackd()
await beanstalkd.connect()

// Publishing a job
await beanstalkd.put("Hello!")

// Consuming a job
const job = await beanstalkd.reserve() // => { id: '1', payload: 'Hello!' }

// Process the job, then delete it
await beanstalkd.delete(job.id)
```

## Installation

```bash
npm install jackd
yarn add jackd
pnpm add jackd
bun add jackd
```

## Why

Beanstalkd is a simple and blazing fast work queue. It's a great tool for building background jobs, queuing up tasks, and more. It deserves a modern Node.js client!

That's where Jackd comes in. Jackd has:

- A concise and easy to use API
- Native promise support
- A single dependency: `yaml`
- Protocol accuracy/completeness

These features put Jackd ahead of other Beanstalkd clients.

If you don't have experience using Beanstalkd, [it's a good idea to read the Beanstalkd protocol before using this library.](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt)

## Overview

Producers connected through TCP sockets (by default on port `11300`) send in jobs to be processed at a later time by a consumer.

### Connecting and disconnecting

```js
const Jackd = require("jackd")
const beanstalkd = new Jackd()

await beanstalkd.connect() // Connects to localhost:11300
await beanstalkd.connect({ host, port })

await beanstalkd.disconnect() // You can also use beanstalkd.quit; it's an alias
```

### Producers

#### Adding jobs into a tube

You can add jobs to a tube by using the `put` command, which accepts a payload and returns a job ID.

Beanstalkd job payloads are byte arrays. Passing in a `Uint8Array` will send the payload as-is.

```js
// This is a byte array of a UTF-8 encoded string
const jobId = await beanstalkd.put(
  new TextEncoder().encode("my long running job")
)
```

You can also pass in a `String` or an `Object` and `jackd` will automatically convert these values into byte arrays.

```js
const jobId = await beanstalkd.put("my long running job") // TextEncoder.encode(string)
const jobId = await beanstalkd.put({ foo: "bar" }) // TextEncoder.encode(JSON.stringify(object))
```

All jobs sent to beanstalkd have a priority, a delay, and TTR (time-to-run) specification. By default, all jobs are published with `0` priority, `0` delay, and `60` TTR, which means consumers will have 60 seconds to finish the job after reservation. You can override these defaults:

```js
await beanstalkd.put(
  { foo: "bar" },
  {
    delay: 2, // Two second delay
    priority: 10,
    ttr: 600 // Ten minute delay
  }
)
```

Jobs with lower priorities are handled first. Refer to [the protocol specs](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt#L126) for more information on job options.

#### Using different tubes

All jobs by default are added to the `default` tube. You can change where you produce jobs with the `use` command.

```js
const tubeName = await beanstalkd.use("awesome-tube") // => 'awesome-tube'
await beanstalkd.put({ foo: "bar" })
```

### Consumers

#### Reserving a job

Consumers reserve jobs from tubes. Using `await` on a `reserve` command is a blocking operation and execution will stop until a job has been reserved.

```js
// Get a job with string payload
const { id, payload } = await beanstalkd.reserve() // wait until job incoming
console.log({ id, payload }) // => { id: '1', payload: 'Hello!' }

// Get a job with raw Uint8Array payload
const { id, payload } = await beanstalkd.reserveRaw() // wait until job incoming
console.log({ id, payload }) // => { id: '1', payload: Uint8Array }
```

When using `reserve()`, the payload will be automatically decoded as a string. This is convenient for text-based payloads.

When using `reserveRaw()`, you'll get the raw `Uint8Array` payload. This is useful when dealing with binary data or when you need to control the decoding yourself:

```js
// Using reserve() for string payloads (automatically decoded)
const { id, payload } = await beanstalkd.reserve()
console.log(payload) // Already a string

// Using reserveRaw() for raw payloads
const { id, payload } = await beanstalkd.reserveRaw()
const message = new TextDecoder().decode(payload) // Manual decoding
```

If you passed in an object when putting the job, you'll need to parse the JSON string:

```js
const { id, payload } = await beanstalkd.reserve()
const object = JSON.parse(payload)
```

#### Performing job operations (delete/bury/touch/release)

Once you've reserved a job, there are several operations you can perform on it. The most common operation will be deleting the job after the consumer is finished processing it.

```js
await beanstalkd.delete(id)
```

Consumers can also give up their reservation by releasing the job. You'll usually want to release the job if an error occurred on the consumer and you want to put it back in the queue immediately.

```js
// Release immediately with high priority (0) and no delay (0)
await beanstalkd.release(id)

// You can also specify the priority and the delay
await beanstalkd.release(id,
  priority: 10
  delay: 10
})
```

However, you may want to bury the job to be processed later under certain conditions, such as a recurring error or a job that can't be processed. Buried jobs will not be processed until they are kicked.

```js
await beanstalkd.bury(id)
// ... some time later ...
await beanstalkd.kickJob(id)
```

You'll notice that the kick operation is suffixed by `Job`. This is because there is a `kick` command in Beanstalkd which will kick a certain number of jobs back into the tube.

```js
await beanstalkd.kick(10) // 10 buried jobs will be moved to a ready state
```

Consumers will sometimes need additional time to run jobs. You can `touch` those jobs to let Beanstalkd know you're still processing them.

```js
await beanstalkd.touch(id)
```

#### Watching on multiple tubes

By default, all consumers will watch the `default` tube only. Consumers can elect what tubes they want to watch.

```js
const numberOfTubesWatched = await beanstalkd.watch("my-special-tube")
// => 2
```

Consumers can also ignore tubes.

```js
const numberOfTubesWatched = await beanstalkd.ignore("default")
// => 1
```

Be aware that attempting to ignore the only tube being watched will return an error.

### Executing YAML commands

Beanstalkd has a number of commands that return YAML payloads. These commands mostly return statistics regarding the current Beanstalkd instance. `jackd`, on purpose, does not ship with a YAML parser. This is to:

- Avoid dependencies
- Stay close to the protocol spec
- Let callers decide how to parse YAML

`jackd` has full support for all commands, so you can expect to find these YAML commands in the API.

```js
const stats = await beanstalkd.stats()
/* =>
---
current-jobs-urgent: 0
current-jobs-ready: 0
current-jobs-reserved: 0
current-jobs-delayed: 0
current-jobs-buried: 0
*/
```

You can then pipe this result through a YAML parser to get the actual contents of the YAML file.

```js
const YAML = require("yaml")
const stats = await beanstalkd.executeMultiPartCommand("stats\r\n")
const { "total-jobs": totalJobs } = YAML.parse(stats)
console.log(totalJobs)
// => 0
```

## Worker pattern

You may be looking to design a process that does nothing else but consume jobs. You can accomplish this with one `jackd` client using `async/await`. Here's an example implementation.

```js
/* consumer.js */
const Jackd = require("jackd")
const beanstalkd = new Jackd()

start()

async function start() {
  // Might want to do some error handling around connections
  await beanstalkd.connect()

  while (true) {
    try {
      const { id, payload } = await beanstalkd.reserve()
      /* ... process job here ... */
      await beanstalkd.delete(id)
    } catch (err) {
      // Log error somehow
      console.error(err)
    }
  }
}
```

# License

MIT
