import React from 'react';
import {Routes, Route} from "react-router-dom";

import MainConverters from './MainConverters';
import MainTools from './MainTools';
import MainHariciye from './MainHariciye';

import Rent from "./hariciye/Rent"; //1 These numbers are for comment component, NUMBER 2 is empty for now
import Customs from "./hariciye/Customs"; 
import CustomsElectric from "./hariciye/CustomsElectric"; //3
import CustomsHybrid from "./hariciye/CustomsHybrid"; //4
import CustomsGasoline from "./hariciye/CustomsGasoline"; //5
import CustomsHybridPlugin from "./hariciye/CustomsHybridPlugin"; //6
import CustomsBike from "./hariciye/CustomsBike"; //7
import CustomsNotes from "./hariciye/CustomsNotes"; //8

import Weight from "./converters/Weight"; //14
import Length from "./converters/Length"; //15
import Temperature from "./converters/Temperature"; //16
import Area from "./converters/Area"; //17
import Volume from "./converters/Volume"; //18
import Time from "./converters/Time"; //19

import Investment from "./subcomponents/Investment"; //20
import Counter from "./wordTools/Counter"; //21
import WordInsulator from "./wordTools/WordInsulator"; //22
import SentenceSplitter from "./wordTools/SentenceSplitter"; //23
import ButtonsCSS from "./subcomponents/ButtonsCSS"; //25

import IndexComp from "./subcomponents/IndexComp";

function MainArea() {

  return (
    <div className='mainArea'>
      <Routes>
             
        <Route path="/investment-return-calculator" element={<Investment/>} />
        <Route path="/kira-yardimi-hesaplama" element={<Rent/>} />

        <Route path="/arac-gumruk-vergi-hesaplama/" element={<Customs/>} />
        <Route path="/benzin-dizel-arac-gumruk-vergi-hesaplama" element={<CustomsGasoline/>} />
        <Route path="/hibrit-arac-gumruk-vergi-hesaplama" element={<CustomsHybrid/>} />
        <Route path="/elektrikli-arac-gumruk-vergi-hesaplama" element={<CustomsElectric/>} />
        <Route path="/plug-in-hibrit-arac-gumruk-vergi-hesaplama" element={<CustomsHybridPlugin/>} />
        <Route path="/motorsiklet-gumruk-vergi-hesaplama" element={<CustomsBike/>} />
        <Route path="/bedelsiz-arac-ithalati-onemli-notlar" element={<CustomsNotes/>} />

        <Route path="/weight-units-converter" element={<Weight/>} />
        <Route path="/length-units-converter" element={<Length/>} />
        <Route path="/temperature-units-converter" element={<Temperature/>} />
        <Route path="/area-units-converter" element={<Area/>} />
        <Route path="/volume-units-converter" element={<Volume/>} />
        <Route path="/time-units-converter" element={<Time/>} />

        <Route path="/character-and-word-counter" element={<Counter/>} />
        <Route path="/word-insulator" element={<WordInsulator/>} />
        <Route path="/sentence-splitter" element={<SentenceSplitter/>} />

        <Route path="/free-css-buttons" element={<ButtonsCSS/>} />
        <Route path="/converters" element={<MainConverters/>} />
        <Route path="/hariciye" element={<MainHariciye/>} />
        <Route path="/tools" element={<MainTools/>} />
        <Route path="/" element={<IndexComp/>} />
      </Routes>
    </div> 
    
  )
}

export default MainArea