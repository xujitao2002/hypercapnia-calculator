# Hypercapnia reassessment research calculator

A browser-based research interface for frozen in-hospital mortality predictions in the study's eligible ICU hypercapnia population. At the 24-hour landmark, it compares a model using current clinical information and the latest paired arterial blood gas with a model that also includes the first blood gas. A first-gas fallback model is available when no qualifying 24-hour repeat exists. The 12-hour route requires a qualifying repeat. The interface also displays the study's aggregate SHAP explanation.

Calculation requires a compatible, authorized model JSON file selected from the user's own device. This public repository contains only the generic interface, inference code and aggregate explanation image. Fitted model parameters, patient records and SHAP background records are not distributed here. Research access to fitted parameters requires the applicable PhysioNet-controlled access arrangement and source-data agreements; contact the study's corresponding author through the manuscript.

The application reads the chosen model file and entered clinical values locally and computes in browser memory. Its code does not upload those values or model parameters, and it contains no application analytics or persistence. The hosting service serves the public static files. Use HTTPS for model checksum verification. This is a research interface; it has not been established for clinical decision-making.

The six application files are preserved from source commit `291139e81b545880a408f6d3eaea325393b94976`. They are static HTML, CSS and JavaScript modules, with no installation or build step. For branch-based GitHub Pages, publish this repository's root folder and retain `.nojekyll`.

Sources: [MIMIC-IV 3.1](https://physionet.org/content/mimiciv/3.1/), [eICU-CRD 2.0](https://physionet.org/content/eicu-crd/2.0/), and [PhysioNet guidance for MIMIC-derived datasets and models](https://physionet.org/news/post/mimic-derived-datasets-models/).
