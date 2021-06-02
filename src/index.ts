import { getCpuUsage } from '@zcong/cpu-usage/dist/default'
import { RollingWindow } from '@zcong/rolling-window'
import debugF from 'debug'

const debug = debugF('adaptive-shedder')

export interface AdaptiveShedderOptions {
  window?: number
  buckets?: number
  cpuThreshold?: number
  minRt?: number
  flyingBeta?: number
  coolOffDuration?: number
  onDrop?: (ds: DropStat) => void
}

export interface DropStat {
  cpu: number
  maxPass: number
  minRt: number
  hot: boolean
  flying: number
  avgFlying: number
}

export class ErrServiceOverloaded extends Error {}

const defaultOptions: AdaptiveShedderOptions = {
  window: 5000,
  buckets: 50,
  cpuThreshold: 80,
  minRt: 1000,
  flyingBeta: 0.9,
  coolOffDuration: 1000,
}

const hr2ms = (hr: [number, number]) => hr[0] * 1e3 + hr[1] / 1e6

export interface Cb {
  fail(): void
  pass(): void
}

export class AdaptiveShedder {
  private windows: number
  private dropTime: [number, number]
  private dropRecently: boolean = false
  private flying: number = 0
  private avgFlying: number = 0
  private passCounter: RollingWindow
  private rtCounter: RollingWindow

  constructor(private readonly options?: AdaptiveShedderOptions) {
    this.options = {
      ...defaultOptions,
      ...options,
    }

    const bucketDuration = this.options.window / this.options.buckets
    this.windows = 1000 / bucketDuration
    this.passCounter = new RollingWindow({
      interval: bucketDuration,
      size: this.options.buckets,
      ignoreCurrent: true,
    })

    this.rtCounter = new RollingWindow({
      interval: bucketDuration,
      size: this.options.buckets,
      ignoreCurrent: true,
    })
  }

  allow(): Cb {
    if (this.shouldDrop()) {
      this.dropTime = process.hrtime()
      this.dropRecently = true
      throw new ErrServiceOverloaded()
    }

    this.addFlying(1)

    const start = process.hrtime()

    return {
      fail: () => {
        this.addFlying(-1)
      },
      pass: () => {
        const rt = hr2ms(process.hrtime(start))
        this.addFlying(-1)
        this.rtCounter.add(rt)
        this.passCounter.add(1)
      },
    }
  }

  private addFlying(delta: number) {
    this.flying += delta

    if (delta < 0) {
      this.avgFlying =
        this.avgFlying * this.options.flyingBeta +
        this.flying * (1 - this.options.flyingBeta)
    }
  }

  private highThru() {
    const maxFlight = this.maxFlight()
    return this.avgFlying > maxFlight && this.flying > maxFlight
  }

  private maxFlight() {
    // windows = buckets per second
    // maxQPS = maxPASS * windows
    // minRT = min average response time in milliseconds
    // maxQPS * minRT / milliseconds_per_second
    return Math.max(1, this.maxPass() * this.windows * (this.minRt() / 1e3))
  }

  private maxPass() {
    let result = 1
    this.passCounter.reduce((b) => {
      if (b.sum > result) {
        result = b.sum
      }
    })

    return result
  }

  private minRt() {
    let result = this.options.minRt
    this.rtCounter.reduce((b) => {
      if (b.count <= 0) {
        return
      }
      const avg = Math.round(b.sum / b.count)
      if (avg < result) {
        result = avg
      }
    })

    return result
  }

  private shouldDrop() {
    if (this.systemOverloaded() || this.stillHot()) {
      if (this.highThru()) {
        const ds: DropStat = {
          cpu: getCpuUsage(),
          maxPass: this.maxPass(),
          minRt: this.minRt(),
          hot: this.stillHot(),
          flying: this.flying,
          avgFlying: this.avgFlying,
        }

        debug('dropreq', ds)

        if (this.options.onDrop) {
          this.options.onDrop(ds)
        }

        return true
      }
    }
    return false
  }

  private stillHot() {
    if (!this.dropRecently) {
      return false
    }

    if (!this.dropTime) {
      return false
    }

    const dur = hr2ms(process.hrtime(this.dropTime))
    const hot = dur < this.options.coolOffDuration
    if (!hot) {
      this.dropRecently = false
    }
    return hot
  }

  private systemOverloaded() {
    return getCpuUsage() >= this.options.cpuThreshold
  }
}
