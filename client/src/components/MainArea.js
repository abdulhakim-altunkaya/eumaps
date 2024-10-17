import React, {useEffect} from 'react';
import axios from 'axios';
import {Routes, Route} from "react-router-dom";

import MainConverters from './MainConverters';
import MainTools from './MainTools';
import MainEinstein from './MainEinstein';

import Rent from "./hariciye/Rent";
import Customs from "./hariciye/Customs";
import CustomsElectric from "./hariciye/CustomsElectric";
import CustomsHybrid from "./hariciye/CustomsHybrid";
import CustomsGasoline from "./hariciye/CustomsGasoline";
import CustomsHybridPlugin from "./hariciye/CustomsHybridPlugin";
import CustomsBike from "./hariciye/CustomsBike";
import CustomsNotes from "./hariciye/CustomsNotes";

import DilationSpeed from "./einstein/DilationSpeed";
import DilationGravity from './einstein/DilationGravity';
import MatterToEnergy from "./einstein/MatterToEnergy";
import LengthContraction from './einstein/LengthContraction';
import RelativisticKinetic from './einstein/RelativisticKinetic';

import Weight from "./converters/Weight";
import Length from "./converters/Length";
import Temperature from "./converters/Temperature";
import Area from "./converters/Area";
import Volume from "./converters/Volume";
import Time from "./converters/Time";

import Investment from "./subcomponents/Investment";
import Counter from "./wordTools/Counter";
import WordInsulator from "./wordTools/WordInsulator";
import SentenceSplitter from "./wordTools/SentenceSplitter";
import SchengenVisa from "./otherTools/SchengenVisa";

import ButtonsCSS from "./subcomponents/ButtonsCSS";
import IndexComp from "./subcomponents/IndexComp";





function MainArea() {

  useEffect(() => {
    const getData = async () => {
      try {
        // Send the request to log the visitor data without awaiting its completion
        axios.post("http://localhost:5000/serversavevisitor", {}).catch((error) => {
          console.error('Error logging visit:', error.message);
        });
      } catch (error) {
        console.log(error.message);
      }
    };
    getData();
  }, []);

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
        
        <Route path="/einstein-mass-energy-converter" element={<MatterToEnergy/>} />
        <Route path="/einstein-time-dilation-calculator" element={<DilationSpeed/>} />
        <Route path="/einstein-gravitational-time-dilation-calculator" element={<DilationGravity/>} />
        <Route path="/einstein-length-contraction-calculator" element={<LengthContraction/>} />
        <Route path="/einstein-relativistic-kinetic-energy-calculator" element={<RelativisticKinetic/>} />

        <Route path="/character-and-word-counter" element={<Counter/>} />
        <Route path="/word-insulator" element={<WordInsulator/>} />
        <Route path="/sentence-splitter" element={<SentenceSplitter/>} />
        <Route path="/schengen-visa-calculator" element={<SchengenVisa/>} />

        <Route path="/free-css-buttons" element={<ButtonsCSS/>} />

        <Route path="/einstein-calculators" element={<MainEinstein/>} />
        <Route path="/converters" element={<MainConverters/>} />
        <Route path="/tools" element={<MainTools/>} />
        <Route path="/" element={<IndexComp/>} />
      </Routes>
    </div> 
    
  )
}

export default MainArea