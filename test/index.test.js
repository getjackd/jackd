const { expect } = require('chai')
const Jackd = require('../dist')
const YAML = require('yaml')
const crypto = require('crypto')

describe('jackd', function () {
  it('can connect to and disconnect from beanstalkd', async function () {
    const c = new Jackd({ useLegacyStringPayloads: true })
    await c.connect()
    await c.close()
  })

  describe('connectivity', function () {
    setupTestSuiteLifecycleWithClient()

    it('connected', function () {
      expect(this.client.connected).to.be.ok
    })

    it('disconnected', async function () {
      await this.client.disconnect()
      expect(this.client.ocnnected).to.not.be.ok
    })
  })

  describe('producers', function () {
    setupTestSuiteLifecycleWithClient()

    it('can insert jobs', async function () {
      let id

      try {
        id = await this.client.put('some random job')
        expect(id).to.be.ok
      } finally {
        if (id) await this.client.delete(id)
      }
    })

    it('can insert jobs with objects', async function () {
      let id

      try {
        id = await this.client.put({ foo: 'bar' })
        expect(id).to.be.ok

        const job = await this.client.reserve()
        expect(String(job.payload)).to.equal('{"foo":"bar"}')
      } finally {
        if (id) await this.client.delete(id)
      }
    })

    it('can insert jobs with priority', async function () {
      let id

      try {
        id = await this.client.put({ foo: 'bar' }, { priority: 12342342 })
        expect(id).to.be.ok

        const job = await this.client.reserve()
        expect(String(job.payload)).to.equal('{"foo":"bar"}')
      } finally {
        if (id) await this.client.delete(id)
      }
    })
  })

  describe('consumers', function () {
    setupTestSuiteLifecycleWithClient()

    it('can reserve jobs', async function () {
      let id
      try {
        id = await this.client.put('some random job')
        const job = await this.client.reserve()

        expect(job.id).to.equal(id)
        expect(String(job.payload)).to.equal('some random job')
      } finally {
        if (id) await this.client.delete(id)
      }
    })

    it('can reserve delayed jobs', async function () {
      let id

      try {
        id = await this.client.put('some random job', {
          delay: 1
        })

        const job = await this.client.reserve()

        expect(job.id).to.equal(id)
        expect(String(job.payload)).to.equal('some random job')
      } finally {
        if (id) await this.client.delete(id)
      }
    })

    it('can reserve jobs by id', async function () {
      let id

      try {
        id = await this.client.put('some random job', {
          delay: 1
        })

        const job = await this.client.reserveJob(id)
        expect(String(job.payload)).to.equal('some random job')
      } finally {
        if (id) await this.client.delete(id)
      }
    })

    it('handles not found', async function () {
      try {
        await this.client.reserveJob(4)
      } catch (err) {
        expect(err.message).to.equal('NOT_FOUND')
      }
    })

    it('can insert and process jobs on a different tube', async function () {
      let id
      try {
        await this.client.use('some-other-tube')
        id = await this.client.put('some random job on another tube')

        await this.client.watch('some-other-tube')
        const job = await this.client.reserve()

        expect(job.id).to.equal(id)
        expect(String(job.payload)).to.equal('some random job on another tube')
      } finally {
        if (id) await this.client.delete(id)
      }
    })

    it('will ignore jobs from default', async function () {
      let id, defaultId
      try {
        defaultId = await this.client.put('job on default')
        await this.client.use('some-other-tube')
        id = await this.client.put('some random job on another tube')

        await this.client.watch('some-other-tube')
        await this.client.ignore('default')

        const job = await this.client.reserve()

        expect(job.id).to.equal(id)
        expect(String(job.payload)).to.equal('some random job on another tube')
      } finally {
        if (id) await this.client.delete(id)
        if (defaultId) await this.client.delete(defaultId)
      }
    })

    it('handles multiple promises fired at once', async function () {
      let id1, id2

      try {
        this.client.use('some-tube')
        const firstJobPromise = this.client.put('some-job')
        this.client.watch('some-random-tube')
        this.client.use('some-another-tube')
        const secondJobPromise = this.client.put('some-job')

        id1 = await firstJobPromise
        id2 = await secondJobPromise
      } finally {
        if (id1) await this.client.delete(id1)
        if (id2) await this.client.delete(id2)
      }
    })

    it('can receive huge jobs', async function () {
      let id

      try {
        // job larger than a socket data frame
        const hugeText =
          crypto.randomBytes(15000).toString('hex') +
          '\r\n' +
          crypto.randomBytes(15000).toString('hex')

        id = await this.client.put(hugeText)
        const job = await this.client.reserve()

        expect(job.id).to.equal(id)
        expect(String(job.payload)).to.equal(hugeText)
      } finally {
        if (id) await this.client.delete(id)
      }
    })

    it('can peek buried jobs', async function () {
      let id
      try {
        await this.client.use('some-tube')

        id = await this.client.put('some-job')

        await this.client.watch('some-tube')
        await this.client.reserve()
        await this.client.bury(id)

        const job = await this.client.peekBuried()

        expect(job.id).to.equal(id)
      } finally {
        if (id) await this.client.delete(id)
      }
    })
  })

  describe('stats', function () {
    setupTestSuiteLifecycleWithClient()

    it('brings back stats', async function () {
      const stats = await this.client.stats()
      YAML.parse(stats)
    })
  })

  describe('bugfixes', function () {
    setupTestSuiteLifecycleWithClient()

    it('can receive jobs with new lines jobs', async function () {
      let id

      try {
        // job larger than a socket data frame
        const payload = 'this job should not fail!\r\n'

        id = await this.client.put(payload)
        const job = await this.client.reserve()

        expect(job.id).to.equal(id)
        expect(String(job.payload)).to.equal(payload)
      } finally {
        if (id) await this.client.delete(id)
      }
    })

    it('can continue execution after bad command', async function () {
      let id

      try {
        // Bad command
        await this.client.delete('nonexistent job')
      } catch (err) {
        expect(err).to.be.an('error')
      }

      try {
        id = await this.client.put('my awesome job')
      } finally {
        if (id) await this.client.delete(id)
      }
    })
  })
})

function setupTestSuiteLifecycleWithClient() {
  beforeEach(async function () {
    this.client = new Jackd()
    await this.client.connect()
  })

  afterEach(async function () {
    await this.client.close()
  })
}
