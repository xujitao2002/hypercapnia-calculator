import { parseVerifiedModelBundle } from './inference.mjs';
import { PACK_SHA256,NUMERIC_FIELDS,computeRequest,syntheticExample } from './rules.mjs';

const form = document.getElementById('risk-form');
const byId = id => document.getElementById(id);
const control = name => form.elements.namedItem(name);
let bundle = null;
let exampleState = false;
let loadEpoch = 0;

function resetResult() {
  byId('result-empty').hidden = false;
  byId('result-values').hidden = true;
  byId('form-error').hidden = true;
}
function updateNode() {
  const node = Number(control('landmark').value);
  byId('fallback-option').disabled = node === 12;
  if (node === 12 && control('reassessment').value === 'none') control('reassessment').value = 'paired';
  const fallback = control('reassessment').value === 'none';
  byId('latest-fields').disabled = fallback;
  if (fallback) for (const name of ['latest_ph','latest_paco2','latest_hour']) control(name).value = '';
  byId('latest-legend').textContent = `复评 · 入ICU${node === 24?'18–24':'8–12'}小时`;
  control('latest_hour').min = node === 24 ? '18' : '8';
  control('latest_hour').max = String(node);
  control('latest_hour').placeholder = node === 24 ? '18–24' : '8–12';
  control('lactate_age_hours').max = control('creatinine_age_hours').max = String(node);
  byId('window-note').textContent = node === 24 ? '24小时有可靠复评时显示H/L对照；无可靠复评时使用B_all备用模型。' : '12小时模型使用8–12小时可靠配对血气。';
  byId('result-context').textContent = `${node}小时 · ${fallback?'B_all备用流程':'同病例H/L比较'}`;
}
function readForm() {
  const request = {landmark:Number(control('landmark').value),reassessment:control('reassessment').value,
    at_landmark:control('at_landmark').checked,available_by_landmark:control('available_by_landmark').checked};
  for (const name of NUMERIC_FIELDS) {
    const field = control(name), raw = field.value.trim();
    if (field.validity.badInput) throw new TypeError('请输入有效数字，未知项目请留空。');
    request[name] = raw === '' ? null : Number(raw);
  }
  return request;
}
function applyRequest(request) {
  control('landmark').value = String(request.landmark);
  control('reassessment').value = request.reassessment;
  for (const key of NUMERIC_FIELDS) control(key).value = request[key] === null ? '' : String(request[key]);
  control('at_landmark').checked = request.at_landmark;
  control('available_by_landmark').checked = request.available_by_landmark;
  updateNode();
}
function render(result) {
  byId('form-error').hidden = true;
  byId('result-empty').hidden = true;
  byId('result-values').hidden = false;
  byId('h-label').textContent = result.p_l === null ? '无可靠复评 · B_all' : '包含首次血气 · H';
  byId('h-risk').textContent = (result.p_h*100).toFixed(1);
  byId('l-block').hidden = byId('difference-block').hidden = result.p_l === null;
  if (result.p_l !== null) {
    byId('l-risk').textContent = (result.p_l*100).toFixed(1);
    byId('probability-difference').textContent = `${result.difference_percentage_points >= 0 ? '+' : ''}${result.difference_percentage_points.toFixed(2)}`;
  }
  byId('model-path').textContent = result.branch;
  byId('missing-count').textContent = `${result.clinical_missing} / 11 项`;
}
function showError(error) {
  resetResult();
  byId('form-error').textContent = error instanceof Error ? error.message : '请核对输入后重新计算。';
  byId('form-error').hidden = false;
}
function calculate(request=readForm()) {
  const result = computeRequest(bundle,request);
  render(result);
  return result;
}

byId('model-file').addEventListener('change',async event => {
  const epoch = ++loadEpoch;
  bundle = null;
  byId('calculate').disabled = true;
  resetResult();
  const file = event.target.files?.[0];
  if (!file) {byId('model-status').textContent = '尚未载入';return;}
  byId('model-status').textContent = '正在核对版本…';
  try {
    if (file.size > 1024*1024 || file.size === 0) throw new TypeError('请选择本研究交付的JSON模型包。');
    const loaded = await parseVerifiedModelBundle(await file.arrayBuffer(),PACK_SHA256);
    if (epoch !== loadEpoch) return;
    bundle = loaded;
    byId('model-status').textContent = '已载入 · 2026-10-09';
    byId('calculate').disabled = false;
  } catch {
    if (epoch !== loadEpoch) return;
    byId('model-status').textContent = '文件版本不匹配，请选择本研究模型包';
  }
});
form.addEventListener('submit',event => {
  event.preventDefault();
  try {calculate();} catch(error) {showError(error);}
});
form.addEventListener('input',() => {
  resetResult();
  if (exampleState) {exampleState = 'edited';byId('input-mode').textContent = '合成示例 · 已编辑';}
});
form.addEventListener('change',event => {
  resetResult();
  if (event.target.name === 'landmark' || event.target.name === 'reassessment') {
    updateNode();
    if (exampleState === true) applyRequest(syntheticExample(Number(control('landmark').value),control('reassessment').value));
  }
});
byId('example').addEventListener('click',() => {
  exampleState = true;
  applyRequest(syntheticExample(Number(control('landmark').value),control('reassessment').value));
  byId('input-mode').textContent = '合成示例';
  resetResult();
});
byId('clear').addEventListener('click',() => {
  const node = control('landmark').value;
  form.reset();
  control('landmark').value = node;
  exampleState = false;
  byId('input-mode').textContent = '手动输入';
  updateNode();resetResult();
});
updateNode();

// Optional browser-standard tools use the same locally loaded model and visible state.
const context = document.modelContext;
if (context?.registerTool) {
  const lifecycle = new AbortController();
  const properties = Object.fromEntries(NUMERIC_FIELDS.map(name => [name,{type:['number','null']}]));
  Object.assign(properties,{landmark:{enum:[12,24]},reassessment:{enum:['paired','none']},at_landmark:{type:'boolean'},available_by_landmark:{type:'boolean'}});
  try {
    Promise.resolve(context.registerTool({name:'calculate_hypercapnia_research_risk',title:'计算研究风险',description:'使用用户已在浏览器本地载入的冻结研究模型，验证输入并更新可见H/L或24小时备用风险结果。模型文件须先由用户本地载入。',inputSchema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(request){
      // Compute first: an invalid request leaves the current form and result intact.
      const result = computeRequest(bundle,request);
      applyRequest(request);exampleState=false;byId('input-mode').textContent='结构化输入';render(result);
      return result;
    }},{signal:lifecycle.signal})).catch(()=>{});
  } catch {}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
