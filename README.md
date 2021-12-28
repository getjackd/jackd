# jackd

[![Build Status](https://img.shields.io/circleci/project/github/getjackd/jackd/master.svg)](https://circleci.com/gh/getjackd/jackd/tree/master)

```js
/* producer.js */
const Jackd = require('jackd')
const beanstalkd = new Jackd()

await beanstalkd.connect()
await beanstalkd.put('Hello!')

/* consumer.js */
const Jackd = require('jackd')
const beanstalkd = new Jackd()

await beanstalkd.connect()
const job = await beanstalkd.reserve() // => { id: '1', payload: 'Hello!' }

// ...process the job... then:
await beanstalkd.delete(job.id)
await beanstalkd.disconnect()
```

## Installation

```
$ npm i jackd
```

### Version 2 fixes a critical bug

> :warning: If you're using `jackd` in production, you should upgrade `jackd` to version 2. [Read more here.](#critical-bug-fixed-in-version-2)

## Why

Most `beanstalkd` clients don't support promises (fivebeans, nodestalker) and the ones that do have too many dependencies (node-beanstalkd-client). This package has:

- A concise and easy to use API
- Native promise support
- No dependencies

If you don't have experience using `beanstalkd`, [it's a good idea to read the `beanstalkd` protocol before using this library.](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt)

## Overview

`beanstalkd` is a simple and blazing fast work queue. Producers connected through TCP sockets (by default on port `11300`) send in jobs to be processed at a later time by a consumer.

### Connecting and disconnecting

```js
const Jackd = require('jackd')
const beanstalkd = new Jackd()

await beanstalkd.connect() // Connects to localhost:11300
await beanstalkd.connect({ host, port })

await beanstalkd.disconnect() // You can also use beanstalkd.close; it's an alias
```

### Producers

#### Adding jobs into a tube

You can add jobs to a tube by using the `put` command, which accepts a payload and returns a job ID.

Normally `beanstalkd` job payloads are byte arrays. Passing in a `Buffer` will send the payload as-is.

```js
// This is a byte array of a UTF-8 encoded string
const jobId = await beanstalkd.put(Buffer.from('my long running job'))
```

You can also pass in a `String` or an `Object` and `jackd` will automatically convert these values into byte arrays.

```js
const jobId = await beanstalkd.put('my long running job') // Buffer.from(string)
const jobId = await beanstalkd.put({ foo: 'bar' }) // Buffer.from(JSON.stringify(object))
```

All jobs sent to beanstalkd have a priority, a delay, and TTR (time-to-run) specification. By default, all jobs are published with `0` priority, `0` delay, and `60` TTR, which means consumers will have 60 seconds to finish the job after reservation. You can override these defaults:

```js
await beanstalkd.put(
  { foo: 'bar' },
  {
    delay: 2, // Two second delay
    priority: new Date().getTime(),
    ttr: 600 // Ten minute delay
  }
)
```

Jobs with lower priorities are handled first. Refer to [the protocol specs](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt#L126) for more information on job options.

#### Using different tubes

All jobs are added to the `default` tube by default. You can change the tube you want to produce a job in by using `use`.

```js
const tubeName = await beanstalkd.use('awesome-tube') // => 'awesome-tube'
await beanstalkd.put({ foo: 'bar' })
```

### Consumers

#### Reserving a job

Consumers work by reserving jobs in a tube. Reserving is a blocking operation and execution will stop until a job has been reserved.

```js
const { id, payload } = await beanstalkd.reserve() // wait until job incoming
console.log({ id, payload }) // => { id: '1', payload: Buffer }
```

`jackd` will return the payload as-is as a `Buffer`. This means you'll have to handle the encoding yourself. For instance, if you sent in an `Object`, you'll need to first convert the `Buffer` to a `String` and then parse the JSON. If you passed in a `String`, the encoding was `UTF-8` by default.

```js
const { id, payload } = await beanstalkd.reserve()
const object = JSON.parse(payload.toString())
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

You'll notice that the kick operation is suffixed by `Job`. This is because there is a `kick` command in `beanstalkd` which will kick a certain number of jobs back into the tube.

```js
await beanstalkd.kick(10) // 10 buried jobs will be moved to a ready state
```

Consumers will sometimes need additional time to run jobs. You can `touch` those jobs to let `beanstalkd` know you're still processing them.

```js
await beanstalkd.touch(id)
```

#### Watching on multiple tubes

By default, all consumers will watch the `default` tube only. So naturally consumers can elect what tubes they want to watch.

```js
const numberOfTubesWatched = await beanstalkd.watch('my-special-tube')
// => 2
```

If a consumer is watching a tube and it no longer needs it, you can choose to ignore that tube as well.

```js
const numberOfTubesWatched = await beanstalkd.ignore('default')
// => 1
```

Please keep in mind that attempting to ignore the only tube being watched will return an error.

You can also bring back the current tubes watched using `list-tubes-watched`. However, there is no first-class support for this command because it returns YAML. This will be discussed in the next section.

### Executing arbitrary commands

`jackd` only has first-class support for commands that do not return YAML. This was an intentional design decision to allow the developer using `jackd` the flexibility to specify what YAML parser they want to use.

To execute commands that return YAML, `jackd` exposes the `executeMultiPartCommand` function:

```js
const stats = await beanstalkd.executeMultiPartCommand('stats\r\n')
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
const YAML = require('yaml')
const stats = await beanstalkd.executeMultiPartCommand('stats\r\n')
const { 'total-jobs': totalJobs } = YAML.parse(stats)
console.log(totalJobs)
// => 0
```

There is also an `executeCommand` method which will allow you to execute arbitary commands on `beanstalkd`. Please keep in mind that support for this use-case is limited.

## Worker pattern

You may be looking to design a process that does nothing else but consume jobs. You can accomplish this with one `jackd` client using `async/await`. Here's an example implementation.

```js
/* consumer.js */
const Jackd = require('jackd')
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

If you need to both publish and consume messages within the same Node.js process you may find it useful to create two connections to `beanstalkd` using `jackd`. While performing `beanstalkd` push/pull operations are supported on a single client, opening two clients will give you the following benefits:

- Likelihood of asynchronicity bugs is diminished (`beanstalkd` is synchronous in nature while Node.js is not)
- Data will flow in one direction per client. One client will only `put`, the other will only `reserve/delete`.
- Similarly, you'll have less tube confusion as you'll only need to `use` on one client and `watch/ignore` on the other.

## Critical bug fixed in version 2

> :warning: Version 1.x of `jackd` erroneously encodes job payloads to and from ASCII. This can lead to job corruption if your jobs are any other encoding (like UTF-8 or binary). **You should upgrade immediately.**

A side effect of this bugfix is that job payloads from reservations are now returned as `Buffer`s and not `string`s. This is a breaking change. However, if you want minimal project impact and want to retain the ASCII functionality where incoming job payloads are encoded into ASCII, you can create `jackd` with the `useLegacyStringPayloads` option:

```
const beanstalkd = new Jackd({ useLegacyStringPayloads: true })
```

Enabling this option should result in a no-op change when upgrading `jackd` (all tests are passing with this option enabled). 

**However you probably shouldn't do this. It's recommended you use `Buffer`s whenever possible.** `jackd` now has first class support for `Buffer`s and will not touch any `Buffer` payloads whatsoever. Working with `Buffer`s is very easy:

```ts
// Publishing
await beanstalkd.put(Buffer.from('my cool job!'))
await beanstalkd.put(Buffer.from(JSON.stringify(myCoolObject)))

// Consuming
const { id, payload: buffer } = await beanstalkd.reserve()
const payload = buffer.toString()
```

For backwards compatibility, `jackd` still has automatic job payload conversion when publishing `string`s and `Object`s. However, job payloads are now UTF-8 encoded, which is the Node.js default.

# License

MIT