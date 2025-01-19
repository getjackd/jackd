import Jackd from "."
import YAML from "yaml"
import crypto from "crypto"

import { describe, it, expect, beforeEach, afterEach } from "vitest"

describe("jackd", () => {
  let client: Jackd

  it("can connect to and disconnect from beanstalkd", async () => {
    const c = new Jackd()
    await c.connect()
    await c.close()
  })

  describe("connectivity", () => {
    setupTestSuiteLifecycleWithClient()

    it("connected", () => {
      expect(client.connected).toBeTruthy()
    })

    it("disconnected", async () => {
      await client.disconnect()
      expect(client.connected).toBeFalsy()
    })
  })

  describe("producers", () => {
    setupTestSuiteLifecycleWithClient()

    it("can insert jobs", async () => {
      let id

      try {
        id = await client.put("some random job")
        expect(id).toBeDefined()
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("can insert jobs with objects", async () => {
      let id: number | undefined

      try {
        id = await client.put({ foo: "bar" })
        expect(id).toBeDefined()

        const job = await client.reserve()
        expect(job.payload).toEqual('{"foo":"bar"}')
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("can insert jobs with priority", async () => {
      let id

      try {
        id = await client.put({ foo: "bar" }, { priority: 12342342 })
        expect(id).toBeDefined()

        const job = await client.reserve()
        expect(job.payload).toEqual('{"foo":"bar"}')
      } finally {
        if (id) await client.delete(id)
      }
    })
  })

  describe("consumers", () => {
    setupTestSuiteLifecycleWithClient()

    it("can reserve jobs", async () => {
      let id: number | undefined

      try {
        id = await client.put("some random job")
        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual("some random job")
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("can reserve jobs with raw payload", async () => {
      let id: number | undefined

      try {
        const testString = "some random job"
        id = await client.put(testString)
        const job = await client.reserveRaw()

        expect(job.id).toEqual(id)
        expect(new TextDecoder().decode(job.payload)).toEqual(testString)
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("can reserve delayed jobs", async () => {
      let id

      try {
        id = await client.put("some random job", {
          delay: 1
        })

        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual("some random job")
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("can reserve jobs by id", async () => {
      let id: number | undefined

      try {
        id = await client.put("some random job", {
          delay: 1
        })

        const job = await client.reserveJob(id)
        expect(job.payload).toEqual("some random job")
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("handles not found", async () => {
      try {
        await client.reserveJob(4)
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toEqual("NOT_FOUND")
      }
    })

    it("can insert and process jobs on a different tube", async () => {
      let id
      try {
        await client.use("some-other-tube")
        id = await client.put("some random job on another tube")

        await client.watch("some-other-tube")
        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual("some random job on another tube")
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("will ignore jobs from default", async () => {
      let id, defaultId
      try {
        defaultId = await client.put("job on default")
        await client.use("some-other-tube")
        id = await client.put("some random job on another tube")

        await client.watch("some-other-tube")
        await client.ignore("default")

        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual("some random job on another tube")
      } finally {
        if (id) await client.delete(id)
        if (defaultId) await client.delete(defaultId)
      }
    })

    it("handles multiple promises fired at once", async () => {
      let id1, id2

      try {
        await client.use("some-tube")
        const firstJobPromise = client.put("some-job")
        await client.watch("some-random-tube")
        await client.use("some-another-tube")
        const secondJobPromise = client.put("some-job")

        id1 = await firstJobPromise
        id2 = await secondJobPromise
      } finally {
        if (id1) await client.delete(id1)
        if (id2) await client.delete(id2)
      }
    })

    it("can receive huge jobs", async () => {
      let id

      try {
        // job larger than a socket data frame
        const hugeText =
          crypto.randomBytes(15000).toString("hex") +
          "\r\n" +
          crypto.randomBytes(15000).toString("hex")

        id = await client.put(hugeText)
        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual(hugeText)
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("can peek buried jobs", async () => {
      let id: number | undefined

      try {
        await client.use("some-tube")

        id = await client.put("some-job")

        await client.watch("some-tube")
        await client.reserve()
        await client.bury(id)

        const job = await client.peekBuried()

        expect(job.id).toEqual(id)
      } finally {
        if (id) await client.delete(id)
      }
    })
  })

  describe("stats", () => {
    setupTestSuiteLifecycleWithClient()

    it("brings back stats", async () => {
      const stats = await client.stats()
      YAML.parse(stats)
    })
  })

  describe("bugfixes", () => {
    setupTestSuiteLifecycleWithClient()

    it("can receive jobs with new lines jobs", async () => {
      let id

      try {
        // job larger than a socket data frame
        const payload = "this job should not fail!\r\n"

        id = await client.put(payload)
        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual(payload)
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("can continue execution after bad command", async () => {
      let id

      try {
        // Bad command
        // @ts-expect-error We're testing the error handling
        await client.delete("nonexistent job")
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
      }

      try {
        id = await client.put("my awesome job")
      } finally {
        if (id) await client.delete(id)
      }
    })
  })

  function setupTestSuiteLifecycleWithClient() {
    beforeEach(async () => {
      client = new Jackd()
      await client.connect()
    })

    afterEach(async () => {
      await client.close()
    })
  }
})
