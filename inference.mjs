/** Exact binary inference for browser_export_v1. No storage or network calls. */
function require(condition, message) {
  if (!condition) throw new TypeError(message);
}

const CLINICAL = ['age','male','heart_rate','respiratory_rate','map','spo2','lactate','creatinine',
  'lactate_age_hours','creatinine_age_hours','gcs_total'];
const MODEL_GAS = {H24:['latest_ph','latest_paco2','first_ph','first_paco2'],
  L24:['latest_ph','latest_paco2'],H12:['latest_ph','latest_paco2','first_ph','first_paco2'],
  L12:['latest_ph','latest_paco2'],B_all:['first_ph','first_paco2']};
function finiteVector(x, n) {
  return Array.isArray(x) && x.length === n && x.every(v => typeof v === 'number' && Number.isFinite(v));
}
function sameArray(a,b) {return Array.isArray(a) && a.length === b.length && a.every((v,i) => v === b[i]);}

/** Validate uploaded structure before inference. Verify the approved SHA256 separately. */
export function validateModelBundle(bundle) {
  require(bundle?.format === 'browser_export_v1' && bundle.publicReleaseAuthorized === false,
    'Unsupported bundle or distribution flag');
  require(bundle.models && sameArray(Object.keys(bundle.models).sort(),Object.keys(MODEL_GAS).sort()),
    'Bundle must contain the five frozen model roles');
  for (const [id, gas] of Object.entries(MODEL_GAS)) {
    const model = bundle.models[id], p = model?.preprocess;
    const isB = id === 'B_all', node = id.endsWith('12') ? 12 : 24;
    require(model?.format === bundle.format && model.id === id && model.landmarkHours === node
      && model.target === `post${node}h_inhospital_death` && sameArray(model.classes,[0,1]), 'Model identity mismatch');
    require(typeof model.frozenArtifactSha256 === 'string' && /^[0-9a-f]{64}$/.test(model.frozenArtifactSha256),
      'Invalid provenance digest');
    require(sameArray(model.rawFeatures,[...CLINICAL,...gas]) && sameArray(p?.clinical,CLINICAL)
      && finiteVector(p.medians,CLINICAL.length) && p.spline === isB && p.interaction === null,
      'Preprocessing contract mismatch');
    require(Array.isArray(p.gas) && p.gas.length === gas.length && p.gas.every((g,i) => g.name === gas[i]),
      'Gas order mismatch');
    const names = [...CLINICAL,...CLINICAL.map(c => `${c}::missing`)];
    for (const g of p.gas) {
      if (isB) {
        require(finiteVector(g.knots,3) && typeof g.degenerate === 'boolean' &&
          (g.degenerate || (g.knots[0] < g.knots[1] && g.knots[1] < g.knots[2])), 'Invalid spline knots');
        names.push(`${g.name}::linear`,`${g.name}::rcs3`);
      } else names.push(g.name);
    }
    require(sameArray(model.transformedFeatures,names), 'Transformed column order mismatch');
    require(model.calibration?.kind === 'sigmoid' && model.calibration.input === 'base decision_function'
      && typeof model.calibration.a === 'number' && Number.isFinite(model.calibration.a)
      && typeof model.calibration.b === 'number' && Number.isFinite(model.calibration.b), 'Invalid calibration');
    const est = model.estimator;
    if (isB) {
      require(est?.kind === 'LogisticRegression' && finiteVector(est.coefficients,names.length)
        && typeof est.intercept === 'number' && Number.isFinite(est.intercept)
        && finiteVector(model.standardize?.mean,names.length) && finiteVector(model.standardize?.scale,names.length)
        && model.standardize.scale.every(v => v > 0), 'Invalid logistic/standardization parameters');
    } else {
      require(est?.kind === 'HistGB' && typeof est.baseline === 'number' && Number.isFinite(est.baseline)
        && est.leafValuesIncludeLearningRate === true && model.standardize === null
        && sameArray(est.nodeColumns,['value','feature','threshold','left','right','leaf','missingLeft'])
        && Array.isArray(est.trees) && est.trees.length === 200, 'Invalid HistGB structure');
      for (const tree of est.trees) {
        require(Array.isArray(tree) && tree.length >= 1 && tree.length <= 13, 'Invalid tree size');
        const visited = new Set(), stack = [0];
        while (stack.length) {
          const i = stack.pop(), n = tree[i];
          require(!visited.has(i) && finiteVector(n,7) && Number.isInteger(n[1]) && n[1] >= 0 && n[1] < names.length
            && [0,1].includes(n[5]) && [0,1].includes(n[6]), 'Invalid node or repeated child');
          visited.add(i);
          if (n[5] === 0) {
            require(Number.isInteger(n[3]) && Number.isInteger(n[4]) && n[3] > i && n[4] > i
              && n[3] < tree.length && n[4] < tree.length && n[3] !== n[4], 'Invalid child index');
            stack.push(n[3],n[4]);
          }
        }
        require(visited.size === tree.length, 'Unreachable nodes');
      }
    }
  }
  return true;
}

/** Parse File.arrayBuffer() locally. expectedSha256 must be the app's approved constant. */
export async function parseVerifiedModelBundle(buffer, expectedSha256) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  require(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= 1024*1024,
    'Model file must be between 1 byte and 1 MiB');
  require(typeof expectedSha256 === 'string' && /^[0-9a-f]{64}$/.test(expectedSha256), 'Invalid approved digest');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2,'0')).join('');
  require(actual === expectedSha256, 'Model file differs from the approved frozen bundle');
  const bundle = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  validateModelBundle(bundle);
  return bundle;
}

/** Select declared raw fields from a larger form; missing fields are rejected. */
export function selectFeatures(model, values) {
  const result = {};
  for (const name of model.rawFeatures) {
    require(Object.prototype.hasOwnProperty.call(values, name), `Missing field: ${name}`);
    result[name] = values[name];
  }
  return result;
}

export function transformInput(model, input) {
  require(model && model.format === 'browser_export_v1', 'Unsupported model format');
  require(input !== null && typeof input === 'object' && !Array.isArray(input), 'Input must be a field object');
  const keys = Object.keys(input);
  require(keys.length === model.rawFeatures.length && keys.every(k => model.rawFeatures.includes(k)),
    'Fields differ from frozen feature whitelist');
  const spec = model.preprocess;
  const x = [];
  const missing = [];
  for (let j = 0; j < spec.clinical.length; j++) {
    const name = spec.clinical[j], value = input[name];
    if (value === null) {
      x.push(spec.medians[j]); missing.push(1);
    } else {
      require(typeof value === 'number' && Number.isFinite(value), `Invalid finite numeric field: ${name}`);
      x.push(value); missing.push(0);
    }
  }
  x.push(...missing);
  for (const gas of spec.gas) {
    const value = input[gas.name];
    require(typeof value === 'number' && Number.isFinite(value), `Blood gas must be finite: ${gas.name}`);
    x.push(value);
    if (spec.spline) {
      const [k0, k1, k2] = gas.knots;
      let d = 0;
      if (!gas.degenerate) {
        const t0 = Math.max(value-k0, 0), t1 = Math.max(value-k1, 0), t2 = Math.max(value-k2, 0);
        d = (t0**3 - t1**3 * (k2-k0)/(k2-k1) + t2**3 * (k1-k0)/(k2-k1)) / (k2-k0)**2;
      }
      x.push(d);
    }
  }
  if (spec.interaction) {
    const q = spec.interaction;
    x.push((input[q.fields[0]]-q.mean[0])/q.scale[0] * (input[q.fields[1]]-q.mean[1])/q.scale[1]);
  }
  require(x.length === model.transformedFeatures.length && x.every(Number.isFinite), 'Invalid transformed values');
  if (model.standardize) {
    for (let i = 0; i < x.length; i++) x[i] = (x[i]-model.standardize.mean[i])/model.standardize.scale[i];
    require(x.every(Number.isFinite), 'Invalid standardized values');
  }
  return x;
}

export function decisionScore(model, input) {
  const x = transformInput(model, input);
  let score;
  if (model.estimator.kind === 'HistGB') {
    const spec = model.estimator;
    score = spec.baseline;
    // Node columns: value, feature, threshold, left, right, leaf, missingLeft.
    // Tree leaf values already include sklearn's learning-rate shrinkage.
    for (const tree of spec.trees) {
      let index = 0, traversed = 0;
      for (;;) {
        const n = tree[index];
        require(n !== undefined && traversed++ <= tree.length, 'Invalid tree topology');
        if (n[5] === 1) { score += n[0]; break; }
        const value = x[n[1]];
        index = Number.isNaN(value) ? (n[6] ? n[3] : n[4]) : (value <= n[2] ? n[3] : n[4]);
      }
    }
  } else if (model.estimator.kind === 'LogisticRegression') {
    score = model.estimator.intercept;
    for (let j = 0; j < x.length; j++) score += x[j] * model.estimator.coefficients[j];
  } else {
    throw new TypeError('Unsupported exported estimator');
  }
  require(Number.isFinite(score), 'Invalid decision score');
  return score;
}

function sigmoid(z) {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Return class-1 death probability; do not round before comparisons. */
export function predictProbability(model, input) {
  const score = decisionScore(model, input);
  const p = sigmoid(-(model.calibration.a * score + model.calibration.b));
  require(Number.isFinite(p) && p >= 0 && p <= 1, 'Invalid probability');
  return p;
}

export function predictProba(model, input) {
  const p = predictProbability(model, input);
  return [1-p, p];
}
