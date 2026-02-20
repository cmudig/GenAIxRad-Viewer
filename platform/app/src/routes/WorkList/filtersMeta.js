import i18n from 'i18next';

const filtersMeta = [
  {
    name: 'description',
    displayName: 'Completed',
    inputType: 'Text',
    isSortable: true,
    gridCol: 4,
  },
  {
    name: 'instances',
    displayName: i18n.t('StudyList:Instances'),
    inputType: 'None',
    isSortable: false,
    gridCol: 2,
  },
];

export default filtersMeta;
