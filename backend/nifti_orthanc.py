from dicom_helpers import nifti_to_dicom, add_metadata_to_series, add_metadata_to_study


findings = "Multiple venous collaterals are present in the anterior left chest wall and are associated with the anterior jugular vein at the level of the right sternoclavicular junction. Left subclavian vein collapsed (chronic occlusion pathology?). Trachea, both main bronchi are open. Calcific plaques are observed in the aortic arch. Other mediastinal main vascular structures, heart contour, size are normal. Thoracic aorta diameter is normal. Pericardial effusion-thickening was not observed. Thoracic esophagus calibration was normal and no significant tumoral wall thickening was detected. No enlarged lymph nodes in prevascular, pre-paratracheal, subcarinal or bilateral hilar-axillary pathological dimensions were detected. When examined in the lung parenchyma window; Linear atelectasis is present in both lung parenchyma. Subsegmental atelectasis is observed in the right middle lobe. Thickening of the bronchial wall and peribronchial budding tree-like reticulonodular densities are observed in the bilateral lower lobes. Peribronchial minimal consolidation is seen in the lower lobes in places. The findings were evaluated primarily in favor of the infectious process. The left kidney partially entering the section is atrophic. The right kidney could not be evaluated because it did not enter the section. Other upper abdominal organs included in the sections are normal. No space-occupying lesion was detected in the liver that entered the cross-sectional area. Bilateral adrenal glands were normal and no space-occupying lesion was detected. There are osteophytes with anterior extension in the thoracic vertebrae."
impressions="Multiple venous collaterals in the anterior left chest wall and collapsed appearance in the left subclavian vein (chronic occlusion?).  Thickening of the bronchial wall in both lungs.  Peribronchial reticulonodular densities in the lower lobes, minimal consolidations (infection process?).  Atelectasis in both lungs.  Thoracic spondylosis."
description="Calcification, Atelectasis, Opacity, Consolidation"
nifti_file = '../data/nifti/ct-rate/train/train_1_a_1.nii.gz'
nifti_to_dicom(nifti_file=nifti_file,
               series_description="Original", 
               modality = "CT",
               study_instance_uid='1.1',
               series_instance_uid='1.1.1',
               study_id='1', 
               patient_name="Example Patient 1",
               patient_id="train_1_a_1",
               description=description,
               )

add_metadata_to_study('1.1', findings, 'Findings')
add_metadata_to_study('1.1', impressions, 'Impressions')

prompt="Multiple venous collaterals in the anterior left chest wall and collapsed appearance in the left subclavian vein (chronic occlusion?).  Thickening of the bronchial wall in both lungs.  Peribronchial reticulonodular densities in the lower lobes, minimal consolidations (infection process?).  Atelectasis in both lungs.  Thoracic spondylosis."
description="Calcification, Atelectasis, Opacity, Consolidation"
nifti_file = '../data/nifti/ct-rate/img_256_standard/train_1_a_1_sample_0.nii.gz'
nifti_to_dicom(nifti_file=nifti_file,
               series_description="Generated, 1", 
               modality = "AI",
               study_instance_uid='1.1',
               series_instance_uid='1.1.2',
               study_id='2', 
               patient_name="Example Patient 1",
               patient_id="train_1_a_1",
               description=description,
)
add_metadata_to_series('1.1.2', prompt, 'SeriesPrompt')

prompt="Multiple venous collaterals in the anterior left chest wall and collapsed appearance in the left subclavian vein (chronic occlusion?).  Thickening of the bronchial wall in both lungs.  Peribronchial reticulonodular densities in the lower lobes, minimal consolidations (infection process?).  Atelectasis in both lungs.  Thoracic spondylosis."
description="Calcification, Atelectasis, Opacity, Consolidation"
nifti_file = '../data/nifti/ct-rate/img_256_standard/train_1_a_1_sample_1.nii.gz'
nifti_to_dicom(nifti_file=nifti_file, 
               series_description="Generated, 2", 
               modality = "AI",
               study_instance_uid='1.1',
               series_instance_uid='1.1.3',
               study_id='3', 
               patient_name="Example Patient 1",
               patient_id="train_1_a_1",
               description=description,
)

add_metadata_to_series('1.1.3', prompt, 'SeriesPrompt')

prompt="Multiple venous collaterals in the anterior left chest wall and collapsed appearance in the left subclavian vein (chronic occlusion?).  Thickening of the bronchial wall in both lungs.  Peribronchial reticulonodular densities in the lower lobes, minimal consolidations (infection process?).  Atelectasis in both lungs.  Thoracic spondylosis."
description="Calcification, Atelectasis, Opacity, Consolidation"
nifti_file = '../data/nifti/ct-rate/img_256_standard/train_1_a_1_sample_2.nii.gz'
nifti_to_dicom(nifti_file=nifti_file, 
               series_description="Generated, 3", 
               modality = "AI",
               study_instance_uid='1.1',
               series_instance_uid='1.1.4',
               study_id='4', 
               patient_name="Example Patient 1",
               patient_id="train_1_a_1",
               description=description,
)
add_metadata_to_series('1.1.4', prompt, 'SeriesPrompt')

prompt="Multiple venous collaterals in the anterior left chest wall and collapsed appearance in the left subclavian vein (chronic occlusion?).  No thickening of the bronchial wall.  Peribronchial reticulonodular densities in the lower lobes, minimal consolidations (infection process?).  Atelectasis in both lungs.  Thoracic spondylosis."
description="Calcification, Atelectasis, Opacity, Consolidation"
nifti_file = '../data/nifti/ct-rate/img_256_standard/train_1_a_1_counterf_1_sample_0.nii.gz'
nifti_to_dicom(nifti_file=nifti_file, 
               series_description="No Thickening (counterfactual 1)", 
               modality = "AI",
               study_instance_uid='1.1',
               series_instance_uid='1.1.5',
               study_id='5',
               patient_name="Example Patient 1",
               patient_id="train_1_a_1",
               description=description,
)
add_metadata_to_series('1.1.5', prompt, 'SeriesPrompt')

prompt="Multiple venous collaterals in the anterior left chest wall and collapsed appearance in the left subclavian vein (chronic occlusion?).  Thickening of the bronchial wall in both lungs.  Peribronchial reticulonodular densities in the lower lobes, large consolidations (infection process?).  Atelectasis in both lungs.  Thoracic spondylosis."
description="Calcification, Atelectasis, Opacity, Consolidation"
nifti_file = '../data/nifti/ct-rate/img_256_standard/train_1_a_1_counterf_2_sample_0.nii.gz'
nifti_to_dicom(nifti_file=nifti_file, 
               series_description="Thickening (counterfactual 2)", 
               modality = "AI",
               study_instance_uid='1.1',
               series_instance_uid='1.1.6',
               study_id='6',
               patient_name="Example Patient 1",
               patient_id="train_1_a_1",
               description=description,
)
add_metadata_to_series('1.1.6', prompt, 'SeriesPrompt')