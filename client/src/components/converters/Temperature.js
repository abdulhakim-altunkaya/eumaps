import React, {useState} from 'react';
import "../../styles/converters.css"; 
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";

function Temperature() {

    const [values, setValues] = useState({
        celsius: "",
        fahrenheit: "",
        kelvin: "",
        rankine: "",
        reaumur: "",
    })

    const convertValues = (name, value) => {
      const conversions = {
          celsius: {
              celsius: value,
              fahrenheit: (value * 9/5) + 32,
              kelvin: value + 273.15,
              rankine: (value + 273.15) * 9/5,
              reaumur: value * 4/5
          },
          fahrenheit: {
              celsius: (value - 32) * 5/9,
              fahrenheit: value,
              kelvin: ((value - 32) * 5/9) + 273.15,
              rankine: value + 459.67,
              reaumur: (value - 32) * 4/9
          },
          kelvin: {
              celsius: value - 273.15,
              fahrenheit: (value - 273.15) * 9/5 + 32,
              kelvin: value,
              rankine: value * 9/5,
              reaumur: (value - 273.15) * 4/5
          },
          rankine: {
              celsius: (value - 491.67) * 5/9,
              fahrenheit: value - 459.67,
              kelvin: value * 5/9,
              rankine: value,
              reaumur: (value - 491.67) * 4/9
          },
          reaumur: {
              celsius: value * 5/4,
              fahrenheit: (value * 9/4) + 32,
              kelvin: (value * 5/4) + 273.15,
              rankine: (value * 9/4) + 491.67,
              reaumur: value
          }
      };
  
      return conversions[name];
  };
  
    
    const handleChangeTemperatureUnits = (e) => {
        const { name, value } = e.target;
        
        if (!isNaN(value) && value !== '') {
            const newValues = convertValues(name, parseFloat(value));
            setValues({
              celsius: parseFloat(newValues.celsius.toString()),
              fahrenheit: parseFloat(newValues.fahrenheit.toString()),
              kelvin: parseFloat(newValues.kelvin.toString()),
              rankine: parseFloat(newValues.rankine.toString()),
              reaumur: parseFloat(newValues.reaumur.toString()),
            });
        } else {
            // If the input value is not a number or is empty, clear all the input fields
            setValues({
              celsius: "",
              fahrenheit: "",
              kelvin: "",
              rankine: "",
              reaumur: "",
            });
        }
    };

    // Function to clear all fields
    const handleClearFields = () => {
      setValues({
        celsius: "",
        fahrenheit: "",
        kelvin: "",
        rankine: "",
        reaumur: "",
      });
    };

  return (
    <div className='convertersMainArea'>
        <h4>TEMPERATURE UNITS CONVERTER</h4>
        <div>
            <input type='number' className='input101' value={values.celsius}  
                name='celsius' onChange={handleChangeTemperatureUnits} /> <label>Celsius (°C)</label> <br/>
            <input type='number' className='input101' value={values.fahrenheit} 
                name='fahrenheit' onChange={handleChangeTemperatureUnits} /> <label>Fahrenheit (°F)</label> <br/>
            <input type='number' className='input101' value={values.kelvin} 
                name='kelvin' onChange={handleChangeTemperatureUnits} /> <label>Kelvin (K)</label> <br/>
            <input type='number' className='input101' value={values.rankine} 
                name='rankine' onChange={handleChangeTemperatureUnits} /> <label>Rankine (°R)</label> <br/>
            <input type='number' className='input101' value={values.reaumur} 
                name='reaumur' onChange={handleChangeTemperatureUnits} /> <label>Réaumur (°Re)</label> <br/><br/>
            <button className='button201' onClick={handleClearFields}>Clear</button>
        </div>
        <div> <br/><br/><br/><br/><br/><br/><br/> </div>
        <div> <CommentDisplay pageId={16}/></div>
        <div> <br/><br/><br/> <Footer /> </div>
    </div>
  )
}

export default Temperature;
  