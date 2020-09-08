import { getCpuUsage } from '@zcong/cpu-usage/dist/default'
import { RollingWindow } from '@zcong/rolling-window'

export interface AdaptiveShedderOptions {
  window?: number
  buckets?: number
  cpuThreshold?: number
  minRt?: number
  flyingBeta?: number
  coolOffDuration?: number
}

const defaultOptions: AdaptiveShedderOptions = {
  window: 5000,
  buckets: 50,
  cpuThreshold: 80,
  minRt: 1000,
  flyingBeta: 0.9,
  coolOffDuration: 1000,
}

export class AdaptiveShedder {
  private windows: number
  private dropTime: number = 0
  private dropRecently: boolean = false
  private flying: number = 0
  private avgFlying: number = 0
  private passCounter: RollingWindow
  private rtCounter: RollingWindow

  constructor(private readonly options: AdaptiveShedderOptions) {
    this.options = {
      ...defaultOptions,
      ...options,
    }

    const bucketDuration = options.window / options.buckets
    this.windows = 1000 / bucketDuration
    this.passCounter = new RollingWindow({
      interval: bucketDuration,
      size: options.buckets,
      ignoreCurrent: true,
    })

    this.rtCounter = new RollingWindow({
      interval: bucketDuration,
      size: options.buckets,
      ignoreCurrent: true,
    })
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
    this.passCounter.reduce((b) => {
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
    // if (this.systemOverloaded() || ) {
    // }
  }

  private stillHot() {
    if (!this.dropRecently) {
      return false
    }
  }

  private systemOverloaded() {
    return getCpuUsage() >= this.options.cpuThreshold
  }
}
