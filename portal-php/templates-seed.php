<?php
/* Starter result templates (parameters, units, reference ranges) for result entry.
   These are common adult defaults only. Reference ranges depend on your analyser and kits:
   your pathologist should review and edit them in the app (Templates page) before reports are issued.
   Param format: [name, unit, low, high, femaleLow, femaleHigh, referenceText]. Numbers drive the H / L flags.
   Text-only results (like Negative / Non-reactive) use null limits and a referenceText. */

function seed_templates() {
  $P = [
    'hb'   => ['Hemoglobin', 'g/dL', 13.0, 17.0, 12.0, 15.0, ''],
    'wbc'  => ['Total WBC count', '/cumm', 4000, 10000, null, null, ''],
    'neu'  => ['Neutrophils', '%', 40, 80, null, null, ''],
    'lym'  => ['Lymphocytes', '%', 20, 40, null, null, ''],
    'mono' => ['Monocytes', '%', 2, 10, null, null, ''],
    'eos'  => ['Eosinophils', '%', 1, 6, null, null, ''],
    'baso' => ['Basophils', '%', 0, 2, null, null, ''],
    'rbc'  => ['RBC count', 'million/cumm', 4.5, 5.5, 3.8, 4.8, ''],
    'pcv'  => ['PCV (Hematocrit)', '%', 40, 50, 36, 46, ''],
    'mcv'  => ['MCV', 'fL', 83, 101, null, null, ''],
    'mch'  => ['MCH', 'pg', 27, 32, null, null, ''],
    'mchc' => ['MCHC', 'g/dL', 31.5, 34.5, null, null, ''],
    'rdw'  => ['RDW-CV', '%', 11.6, 14.0, null, null, ''],
    'plt'  => ['Platelet count', '/cumm', 150000, 410000, null, null, ''],
    'esr'  => ['ESR (1st hour)', 'mm/hr', 0, 15, 0, 20, ''],

    'chol' => ['Total Cholesterol', 'mg/dL', null, 200, null, null, '< 200 Desirable'],
    'trig' => ['Triglycerides', 'mg/dL', null, 150, null, null, '< 150 Normal'],
    'hdl'  => ['HDL Cholesterol', 'mg/dL', 40, null, 50, null, '> 40 (men), > 50 (women)'],
    'ldl'  => ['LDL Cholesterol', 'mg/dL', null, 100, null, null, '< 100 Optimal'],
    'vldl' => ['VLDL Cholesterol', 'mg/dL', 5, 40, null, null, ''],
    'nhdl' => ['Non-HDL Cholesterol', 'mg/dL', null, 130, null, null, '< 130 Desirable'],
    'chr'  => ['Cholesterol / HDL ratio', '', null, 5.0, null, null, '< 5.0'],

    'bilt' => ['Bilirubin - Total', 'mg/dL', 0.3, 1.2, null, null, ''],
    'bild' => ['Bilirubin - Direct', 'mg/dL', 0.0, 0.3, null, null, ''],
    'bili' => ['Bilirubin - Indirect', 'mg/dL', 0.2, 0.9, null, null, ''],
    'sgot' => ['SGOT (AST)', 'U/L', 5, 40, 5, 32, ''],
    'sgpt' => ['SGPT (ALT)', 'U/L', 5, 45, 5, 35, ''],
    'alp'  => ['Alkaline Phosphatase', 'U/L', 44, 147, null, null, ''],
    'tp'   => ['Total Protein', 'g/dL', 6.0, 8.3, null, null, ''],
    'alb'  => ['Albumin', 'g/dL', 3.5, 5.2, null, null, ''],
    'glob' => ['Globulin', 'g/dL', 2.0, 3.5, null, null, ''],
    'ag'   => ['A/G ratio', '', 1.0, 2.1, null, null, ''],

    'urea' => ['Urea', 'mg/dL', 17, 43, null, null, ''],
    'bun'  => ['Blood Urea Nitrogen (BUN)', 'mg/dL', 7, 20, null, null, ''],
    'crea' => ['Creatinine', 'mg/dL', 0.7, 1.3, 0.6, 1.1, ''],
    'uric' => ['Uric Acid', 'mg/dL', 3.5, 7.2, 2.6, 6.0, ''],
    'ca'   => ['Calcium', 'mg/dL', 8.6, 10.2, null, null, ''],
    'phos' => ['Phosphorus', 'mg/dL', 2.5, 4.5, null, null, ''],
    'na'   => ['Sodium', 'mmol/L', 135, 145, null, null, ''],
    'k'    => ['Potassium', 'mmol/L', 3.5, 5.1, null, null, ''],
    'cl'   => ['Chloride', 'mmol/L', 98, 107, null, null, ''],
    'mg'   => ['Magnesium', 'mg/dL', 1.7, 2.2, null, null, ''],

    't3'   => ['Total T3', 'ng/dL', 80, 200, null, null, ''],
    't4'   => ['Total T4', 'ug/dL', 5.1, 14.1, null, null, ''],
    'tsh'  => ['TSH', 'uIU/mL', 0.4, 4.0, null, null, ''],
    'ft3'  => ['Free T3', 'pg/mL', 2.3, 4.2, null, null, ''],
    'ft4'  => ['Free T4', 'ng/dL', 0.8, 1.8, null, null, ''],

    'fbs'  => ['Fasting Blood Sugar', 'mg/dL', 70, 100, null, null, '70 - 100 Normal'],
    'ppbs' => ['Post-prandial Blood Sugar', 'mg/dL', null, 140, null, null, '< 140 Normal'],
    'hba'  => ['HbA1c', '%', 4.0, 5.6, null, null, 'Normal < 5.7, Pre-diabetes 5.7 - 6.4, Diabetes >= 6.5'],
    'vitd' => ['25-OH Vitamin D (Total)', 'ng/mL', 30, 100, null, null, 'Deficient < 20, Insufficient 20 - 29, Sufficient 30 - 100'],
    'ferr' => ['Ferritin', 'ng/mL', 24, 336, 11, 307, ''],
    'iron' => ['Iron', 'ug/dL', 65, 175, 50, 170, ''],
    'crp'  => ['C-Reactive Protein (CRP)', 'mg/L', null, 6, null, null, '< 6'],
    'psa'  => ['Prostate Specific Antigen (PSA)', 'ng/mL', null, 4.0, null, null, '< 4.0'],

    'u_col' => ['Colour', '', null, null, null, null, 'Pale yellow'],
    'u_app' => ['Appearance', '', null, null, null, null, 'Clear'],
    'u_ph'  => ['pH', '', 4.6, 8.0, null, null, ''],
    'u_sg'  => ['Specific gravity', '', 1.005, 1.030, null, null, ''],
    'u_pro' => ['Protein', '', null, null, null, null, 'Nil'],
    'u_glu' => ['Glucose', '', null, null, null, null, 'Nil'],
    'u_ket' => ['Ketones', '', null, null, null, null, 'Nil'],
    'u_bil' => ['Bilirubin', '', null, null, null, null, 'Negative'],
    'u_uro' => ['Urobilinogen', '', null, null, null, null, 'Normal'],
    'u_bld' => ['Blood', '', null, null, null, null, 'Nil'],
    'u_nit' => ['Nitrite', '', null, null, null, null, 'Negative'],
    'u_pus' => ['Pus cells', '/hpf', 0, 5, null, null, ''],
    'u_rbc' => ['Red blood cells', '/hpf', 0, 2, null, null, ''],
    'u_epi' => ['Epithelial cells', '/hpf', 0, 5, null, null, ''],
    'u_cas' => ['Casts', '', null, null, null, null, 'Nil'],
    'u_cry' => ['Crystals', '', null, null, null, null, 'Nil'],
    'u_bac' => ['Bacteria', '', null, null, null, null, 'Nil'],

    'mp'   => ['Malarial Parasite', '', null, null, null, null, 'Not seen'],
    'ns1'  => ['Dengue NS1 Antigen', '', null, null, null, null, 'Negative'],
    'hiv'  => ['HIV I and II', '', null, null, null, null, 'Non-reactive'],
    'hbs'  => ['HBsAg', '', null, null, null, null, 'Non-reactive'],
  ];

  // Panels (several parameters). 'match' = words that auto-select this panel for a billed line.
  $panels = [
    'P:CBC'   => ['Complete Blood Count (CBC)', ['hb', 'rbc', 'pcv', 'mcv', 'mch', 'mchc', 'rdw', 'wbc', 'neu', 'lym', 'mono', 'eos', 'baso', 'plt'], ['CBC', 'COMPLETE BLOOD', 'HEMOGRAM']],
    'P:LIPID' => ['Lipid Profile', ['chol', 'trig', 'hdl', 'ldl', 'vldl', 'nhdl', 'chr'], ['LIPID PROFILE']],
    'P:LFT'   => ['Liver Function Test (LFT)', ['bilt', 'bild', 'bili', 'sgot', 'sgpt', 'alp', 'tp', 'alb', 'glob', 'ag'], ['LIVER FUNCTION', 'LFT']],
    'P:KFT'   => ['Kidney Function Test (KFT)', ['urea', 'bun', 'crea', 'uric', 'ca', 'phos', 'na', 'k', 'cl'], ['KIDNEY FUNCTION', 'RENAL', 'KFT']],
    'P:THY'   => ['Thyroid Profile', ['t3', 't4', 'tsh'], ['THYROID PROFILE', 'T3 T4 TSH']],
    'P:URINE' => ['Urine Routine Examination', ['u_col', 'u_app', 'u_ph', 'u_sg', 'u_pro', 'u_glu', 'u_ket', 'u_bil', 'u_uro', 'u_bld', 'u_nit', 'u_pus', 'u_rbc', 'u_epi', 'u_cas', 'u_cry', 'u_bac'], ['URINE ROUTINE', 'URINE EXAMINATION', 'URINE R/M']],
    'P:DIAB'  => ['Diabetes Panel', ['fbs', 'ppbs', 'hba'], ['DIABETIC', 'DIABETES']],
  ];

  // Individual tests from the price list (key = type:code as in data.js)
  $singles = [
    'T:HEMGN' => ['hb'], 'T:PLT' => ['plt'], 'T:ESR' => ['esr'],
    'T:CHOL' => ['chol'], 'T:TRIG' => ['trig'], 'T:HCHO' => ['hdl'], 'T:LDL' => ['ldl'],
    'T:BILT' => ['bilt'], 'T:BILD' => ['bild'], 'T:SGOT' => ['sgot'], 'T:SGPT' => ['sgpt'], 'T:ALKP' => ['alp'], 'T:PROT' => ['tp'], 'T:SALB' => ['alb'],
    'T:SCRE' => ['crea'], 'T:URIC' => ['uric'], 'T:CALC' => ['ca'], 'T:SODI' => ['na'], 'T:POT' => ['k'], 'T:CHL' => ['cl'], 'T:MG' => ['mg'],
    'T:T3' => ['t3'], 'T:T4' => ['t4'], 'T:USTSH' => ['tsh'], 'T:FT3' => ['ft3'], 'T:FT4' => ['ft4'],
    'T:FBS' => ['fbs'], 'T:PPBS' => ['ppbs'], 'T:HBA' => ['hba'], 'T:VITDC' => ['vitd'], 'T:FERR' => ['ferr'], 'T:IRON' => ['iron'], 'T:CRP' => ['crp'], 'T:PSA' => ['psa'],
    'T:MP' => ['mp'], 'T:NS1' => ['ns1'], 'T:DGNS1' => ['ns1'], 'T:HIVE' => ['hiv'], 'T:SAG' => ['hbs'], 'T:HBSAG' => ['hbs'],
  ];

  $build = function ($ids) use ($P) {
    $out = [];
    foreach ($ids as $id) { $p = $P[$id]; $out[] = ['name' => $p[0], 'unit' => $p[1], 'low' => $p[2], 'high' => $p[3], 'flo' => $p[4], 'fhi' => $p[5], 'ref' => $p[6]]; }
    return $out;
  };
  $res = [];
  foreach ($panels as $k => $v) $res[] = ['key' => $k, 'name' => $v[0], 'params' => $build($v[1]), 'match' => $v[2]];
  foreach ($singles as $k => $ids) $res[] = ['key' => $k, 'name' => $P[$ids[0]][0], 'params' => $build($ids), 'match' => []];
  return $res;
}
