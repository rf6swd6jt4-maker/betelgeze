import test from 'node:test'
import assert from 'node:assert/strict'
import {effectiveHorizon,horizonDay,calibratedFactor,parseFeedback,HORIZON_LABELS,dayInTimezone} from '../lib/work-queue/feedback-policy.ts'
test('Four qualitative bands use the requested vocabulary',()=>assert.deepEqual(Object.values(HORIZON_LABELS),['Must do now','Must be done today','Can be done tomorrow','Can be done this week']))
test('Tomorrow ages to today without sliding, and now is not a clock deadline',()=>{
 assert.equal(effectiveHorizon('tomorrow','2026-09-15','2026-09-16'),'today');assert.equal(effectiveHorizon('tomorrow','2026-09-15','2026-09-17'),'today');assert.equal(effectiveHorizon('now','2026-09-15','2026-09-17'),'now');assert.equal(horizonDay('week','2026-09-15'),'2026-09-18')
})
test('Timezone controls the day boundary without simulated working hours',()=>assert.equal(dayInTimezone(Date.parse('2026-09-15T23:30:00Z'),'Europe/Dublin'),'2026-09-16'))
test('Calibration requires repeated samples and is bounded to five points',()=>{
 assert.equal(calibratedFactor(1,[2,2,2,2],4),1);assert.equal(calibratedFactor(1,[2,2,2,2,2],5),1.05);assert.equal(calibratedFactor(1,[.1,.1,.1,.1,.1],5),.95);assert.equal(calibratedFactor(2,[4,4,4,4,4],5),2)
})
test('Feedback output rejects unsupported categories and malformed values',()=>{
 assert.throws(()=>parseFeedback({category:'fire_worker',summary:'x',suggestion:'x',confidence:99}));assert.throws(()=>parseFeedback({category:'estimate',summary:'x',suggestion:'x',confidence:NaN}));assert.equal(parseFeedback({category:'estimate',summary:'Review scope',suggestion:'Check missing steps',confidence:70}).category,'estimate')
})
