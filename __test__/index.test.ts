import { RollingWindow, MockTimer } from '@zcong/rolling-window'
import { AdaptiveShedder } from '../src'

const bucket = 10
const interval = 50

it('test max pass', async () => {
  const mt = new MockTimer()
  const passCounter = new RollingWindow(
    {
      size: bucket,
      interval,
      ignoreCurrent: true,
    },
    mt
  )
  const a = new AdaptiveShedder()
  ;(a as any).passCounter = passCounter
  for (let i = 0; i <= 10; i++) {
    passCounter.add(i * 100)
    mt.add(interval * 1e6)
  }
  expect((a as any).maxPass()).toBe(1000)

  const a1 = new AdaptiveShedder()
  expect((a1 as any).maxPass()).toBe(1)
})

it('test min rt', async () => {
  const mt = new MockTimer()
  const rtCounter = new RollingWindow(
    {
      size: bucket,
      interval,
      ignoreCurrent: true,
    },
    mt
  )
  const a = new AdaptiveShedder()
  ;(a as any).rtCounter = rtCounter
  for (let i = 0; i < 10; i++) {
    if (i > 0) {
      mt.add(interval * 1e6)
    }
    for (let j = i * 10 + 1; j <= i * 10 + 10; j++) {
      rtCounter.add(j)
    }
  }
  expect((a as any).minRt()).toBe(6)

  const a1 = new AdaptiveShedder()
  expect((a1 as any).minRt()).toBe(1000)
})

it('test max flight', async () => {
  const mt = new MockTimer()
  const passCounter = new RollingWindow(
    {
      size: bucket,
      interval,
      ignoreCurrent: true,
    },
    mt
  )
  const rtCounter = new RollingWindow(
    {
      size: bucket,
      interval,
      ignoreCurrent: true,
    },
    mt
  )
  const a = new AdaptiveShedder()
  ;(a as any).passCounter = passCounter
  ;(a as any).rtCounter = rtCounter

  for (let i = 0; i < 10; i++) {
    if (i > 0) {
      mt.add(interval * 1e6)
    }
    passCounter.add((i + 1) * 100)
    for (let j = i * 10 + 1; j <= i * 10 + 10; j++) {
      rtCounter.add(j)
    }
  }

  expect((a as any).maxFlight()).toBe(54)
})

it('test should drop', async () => {
  const mt = new MockTimer()
  const passCounter = new RollingWindow(
    {
      size: bucket,
      interval,
      ignoreCurrent: true,
    },
    mt
  )
  const rtCounter = new RollingWindow(
    {
      size: bucket,
      interval,
      ignoreCurrent: true,
    },
    mt
  )
  const a = new AdaptiveShedder()
  ;(a as any).passCounter = passCounter
  ;(a as any).rtCounter = rtCounter

  for (let i = 0; i < 10; i++) {
    if (i > 0) {
      mt.add(interval * 1e6)
    }
    passCounter.add((i + 1) * 100)
    for (let j = i * 10 + 1; j <= i * 10 + 10; j++) {
      rtCounter.add(j)
    }
  }
  // cpu >=  800, inflight < maxPass
  ;(a as any).systemOverloaded = () => true
  ;(a as any).avgFlying = 50
  expect((a as any).shouldDrop()).toBeFalsy()

  // cpu >=  800, inflight > maxPass
  ;(a as any).avgFlying = 80
  ;(a as any).flying = 50
  expect((a as any).shouldDrop()).toBeFalsy()

  // cpu >=  800, inflight > maxPass
  ;(a as any).avgFlying = 80
  ;(a as any).flying = 80
  expect((a as any).shouldDrop()).toBeTruthy()

  // cpu < 800, inflight > maxPass
  ;(a as any).systemOverloaded = () => false
  ;(a as any).avgFlying = 80
  expect((a as any).shouldDrop()).toBeFalsy()
})
