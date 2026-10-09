import { predictProbability, selectFeatures } from './inference.mjs';

export const PACK_SHA256 = 'ebafd01016f8dbc6ccea2b2659a67ae7d58e471de4579c48d3ea98e67bea75ac';
export const CLINICAL = ['age','male','heart_rate','respiratory_rate','map','spo2','lactate','creatinine','lactate_age_hours','creatinine_age_hours','gcs_total'];
export const NUMERIC_FIELDS = [...CLINICAL,'first_ph','first_paco2','first_hour','latest_ph','latest_paco2','latest_hour'];
const LABELS = {age:'年龄',male:'性别',heart_rate:'心率',respiratory_rate:'呼吸频率',map:'MAP',spo2:'SpO₂',lactate:'乳酸',creatinine:'肌酐',lactate_age_hours:'乳酸距节点时间',creatinine_age_hours:'肌酐距节点时间',gcs_total:'GCS',first_ph:'首次pH',first_paco2:'首次PaCO₂',first_hour:'首次采样时间',latest_ph:'复评pH',latest_paco2:'复评PaCO₂',latest_hour:'复评采样时间'};
const RANGES = {age:[18,120],heart_rate:[20,250],respiratory_rate:[2,80],map:[20,200],spo2:[40,100],lactate:[0,50],creatinine:[0,30],gcs_total:[3,15],first_ph:[6.5,8],first_paco2:[45,300],first_hour:[0,6],latest_ph:[6.5,8],latest_paco2:[5,300]};
const ensure = (ok, message) => { if (!ok) throw new TypeError(message); };

export function validateRequest(request) {
  ensure(request && typeof request === 'object' && !Array.isArray(request),'请填写计算信息。');
  const allowed = ['landmark','reassessment','at_landmark','available_by_landmark',...NUMERIC_FIELDS];
  ensure(Object.keys(request).every(k => allowed.includes(k)),'输入含未定义字段。');
  const node = request.landmark;
  ensure(node === 12 || node === 24,'请选择12或24小时节点。');
  ensure(request.reassessment === 'paired' || request.reassessment === 'none','请选择复评血气状态。');
  ensure(request.at_landmark === true,'请确认患者已满节点，仍存活且在ICU。');
  ensure(request.available_by_landmark === true,'请确认所填信息在节点前已可获得。');
  ensure(!(node === 12 && request.reassessment === 'none'),'12小时模型需要8–12小时的可靠配对血气。');
  const values = {};
  const fallback = request.reassessment === 'none';
  for (const key of NUMERIC_FIELDS) {
    const v = request[key];
    ensure(v === null || (typeof v === 'number' && Number.isFinite(v)),`${LABELS[key]}须为有效数值，未知项目请留空。`);
    if (fallback && key.startsWith('latest_')) {
      ensure(v === null,'选择无可靠复评时，复评数值应留空。');
    }
    if (v !== null && RANGES[key]) {
      const [min,max] = RANGES[key];
      ensure(v >= min && v <= max,`${LABELS[key]}应在${min}–${max}范围内，请核对单位或留空。`);
    }
    values[key] = v;
  }
  for (const key of ['age','first_ph','first_paco2','first_hour',...(!fallback ? ['latest_ph','latest_paco2','latest_hour'] : [])])
    ensure(values[key] !== null,`请填写${LABELS[key]}。`);
  ensure(values.first_paco2 > 45,'本研究人群要求首次动脉PaCO₂大于45 mmHg。');
  ensure(values.male === null || values.male === 0 || values.male === 1,'性别请选择女性、男性或未知。');
  ensure(values.creatinine === null || values.creatinine > 0,'肌酐应大于0，未知时留空。');
  ensure(values.gcs_total === null || Number.isInteger(values.gcs_total),'GCS须为3–15的整数，不可测时留空。');
  for (const lab of ['lactate','creatinine']) {
    const age = `${lab}_age_hours`;
    ensure((values[lab] === null) === (values[age] === null),`${LABELS[lab]}与距节点时间请一起填写，或同时留空。`);
    ensure(values[age] === null || (values[age] >= 0 && values[age] <= node),`${LABELS[age]}应在0–${node}小时内。`);
  }
  if (!fallback) ensure(values.latest_hour >= (node === 24 ? 18 : 8) && values.latest_hour <= node,`复评采样时间应在入ICU${node === 24 ? '18–24' : '8–12'}小时内。`);
  values.age = Math.min(values.age,90);
  return { node, fallback, values, missing: CLINICAL.filter(k => values[k] === null).length };
}

export function computeRequest(bundle, request) {
  ensure(bundle?.models,'请先载入本机研究模型。');
  const {node,fallback,values,missing} = validateRequest(request);
  const hId = fallback ? 'B_all' : `H${node}`;
  const hModel = bundle.models[hId];
  const h = predictProbability(hModel,selectFeatures(hModel,values));
  let l = null;
  if (!fallback) {
    const lModel = bundle.models[`L${node}`];
    l = predictProbability(lModel,selectFeatures(lModel,values));
  }
  return {landmark:node,branch:fallback?'B_all':`${hId}/L${node}`,p_h:h,p_l:l,difference_percentage_points:l === null ? null : 100*(h-l),clinical_missing:missing};
}

export function syntheticExample(node=24, reassessment='paired') {
  const latest = reassessment === 'paired';
  return {landmark:node,reassessment,at_landmark:true,available_by_landmark:true,
    age:65,male:1,heart_rate:96,respiratory_rate:24,map:70,spo2:92,lactate:2.1,creatinine:1,
    lactate_age_hours:3,creatinine_age_hours:6,gcs_total:14,first_ph:7.26,first_paco2:63,first_hour:2,
    latest_ph:latest?7.35:null,latest_paco2:latest?48:null,latest_hour:latest?(node === 24 ? 22:11):null};
}
