import React from 'react';
import {Routes, Route} from "react-router-dom";
import SpeedOfLight from "./subcomponents/SpeedOfLight";
import Investment from "./subcomponents/Investment";
import Rent from "./subcomponents/Rent";
import Customs from "./subcomponents/Customs";
import CustomsElectric from "./subcomponents/CustomsElectric";
import CustomsHybrid from "./subcomponents/CustomsHybrid";
import CustomsGasoline from "./subcomponents/CustomsGasoline";
import CustomsHybridPlugin from "./subcomponents/CustomsHybridPlugin";
import CustomsBike from "./subcomponents/CustomsBike";
import CustomsNotes from "./subcomponents/CustomsNotes";
import IndexComp from "./subcomponents/IndexComp";

function MainArea() {
  return (
    <div className='mainArea'>
      <Routes>
        <Route path="/speed-of-light-calculator" element={<SpeedOfLight/>} />
        <Route path="/investment-return-calculator" element={<Investment/>} />
        <Route path="/kira-yardimi-hesaplama" element={<Rent/>} />

        <Route path="/arac-gumruk-vergi-hesaplama/" element={<Customs/>} />
        <Route path="/benzin-dizel-arac-gumruk-vergi-hesaplama" element={<CustomsGasoline/>} />
        <Route path="/hibrit-arac-gumruk-vergi-hesaplama" element={<CustomsHybrid/>} />
        <Route path="/elektrikli-arac-gumruk-vergi-hesaplama" element={<CustomsElectric/>} />
        <Route path="/plug-in-hibrit-arac-gumruk-vergi-hesaplama" element={<CustomsHybridPlugin/>} />
        <Route path="/motorsiklet-gumruk-vergi-hesaplama" element={<CustomsBike/>} />
        <Route path="/bedelsiz-arac-ithalati-onemli-notlar" element={<CustomsNotes/>} />

        <Route path="/" element={<IndexComp/>} />
      </Routes>
    </div> 
    
  )
}

export default MainArea