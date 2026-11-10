const green = {50:'#f4f6ee',100:'#e7ecd9',200:'#d5dec6',300:'#b6c7a2',400:'#8fa877',500:'#65834f',600:'#3c5d35',700:'#2b4826',800:'#263e25',900:'#243b22',950:'#192d18'};
module.exports = {
  content:['./components/admin/**/*.{ts,tsx}','./components/{Modal,ConfirmModal,Toast}.tsx','./pages/PriceManagement/PriceSettingsView.tsx'],
  important: '.h-admin',
  corePlugins: {preflight:false},
  theme:{extend:{colors:{brand:green,blue:green,indigo:green},fontFamily:{sans:['DM Sans','system-ui','sans-serif']}}},
};
