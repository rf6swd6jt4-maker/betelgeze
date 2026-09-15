import test from 'node:test'
import assert from 'node:assert/strict'
import {validateAssetSelections,assetSelectionSchema} from '../lib/sops/asset-selection.ts'
const id='00000000-0000-4000-8000-000000000001'
const source={summary:'Tracking',applicability:[],missing_information:[],warnings:[],steps:[{title:'Verify tracking',instruction:'Compare the conversion settings against the approved reference screenshot.',source_quote:'Compare the conversion settings',source_location:'Page 1',condition:'',kind:'requirement' as const,image_ids:[id]}]}
const candidates=[{id,title:'Tracking reference',description:'Approved conversion settings screenshot with the required verification values.',kind:'extracted_image' as const,source_steps:[1],version:'v1'}]
const attachment={asset_id:id,source_step:1,source_quote:'Compare the conversion settings',asset_quote:'Approved conversion settings screenshot',reason:'Shows the specific conversion settings to verify.'}
const task={title:'Verify tracking',instructions:source.steps[0].instruction,description:'Verify settings',completion_requirements:['Settings match'],task_type:'implementation' as const,requested_inputs:[],source_steps:[1],depends_on:[],blocked_reason:'',attachments:[attachment]}
test('attachments require source and asset evidence, with abstention supported',()=>{
 const plan={summary:'Setup',warnings:[],tasks:[task]};assert.equal(validateAssetSelections(plan,source,candidates,true),plan)
 assert.doesNotThrow(()=>validateAssetSelections({...plan,tasks:[{...task,attachments:[]}]},source,[],true))
 for(const bad of [{...attachment,asset_id:'unknown'},{...attachment,source_step:2},{...attachment,source_quote:'tracking'},{...attachment,asset_quote:'A screenshot of a different dashboard'},{...attachment,reason:'Relevant'}])assert.throws(()=>validateAssetSelections({...plan,tasks:[{...task,attachments:[bad]}]},source,candidates,true))
 assert.throws(()=>validateAssetSelections(plan,source,[{...candidates[0],source_steps:[]}],true),/source steps/)
 assert.throws(()=>validateAssetSelections({...plan,tasks:[{...task,task_type:'request_information'}]},source,candidates,true))
 assert.throws(()=>validateAssetSelections({...plan,tasks:[{...task,attachments:[attachment,attachment]}]},source,candidates,true))
 assert.equal(assetSelectionSchema([],source).maxItems,0)
})
