import React, {useEffect} from 'react';
import axios from 'axios';
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

import Weight from "./converters/Weight";
import Length from "./converters/Length";
import Temperature from "./converters/Temperature";
import Area from "./converters/Area";
import Volume from "./converters/Volume";
import Time from "./converters/Time";

import Counter from "./wordTools/Counter";
import WordInsulator from "./wordTools/WordInsulator";
import SentenceSplitter from "./wordTools/SentenceSplitter";

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

        <Route path="/" element={<IndexComp/>} />
      </Routes>
    </div> 
    
  )
}

export default MainArea