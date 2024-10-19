import React, {useState} from 'react';
import "../../styles/converters.css"; 
import CommentDisplay from '../CommentDisplay'; 

function Weight() {

    const [values, setValues] = useState({
        milligram: "",
        gram: "",
        kilogram: "",
        ton: "",
        megaton: "",
        gigaton: "",
        uston: "",
        pound: "",
        ounce: "",
        carat: "",
    })

    const convertValues = (name, value) => {
        const conversions = {
          milligram: {
            milligram: value,
            gram: value / 1000,
            kilogram: value / 1e6,
            ton: value / 1e9,
            megaton: value / 1e12,
            gigaton: value / 1e15,
            uston: value / 907184.74,
            pound: value / 453592.37,
            ounce: value / 28349.5,
            carat: value / 200,
          },
          gram: {
            milligram: value * 1000,
            gram: value,
            kilogram: value / 1000,
            ton: value / 1e6,
            megaton: value / 1e9,
            gigaton: value / 1e12,
            uston: value / 907184.74,
            pound: value / 453.59237,
            ounce: value / 28.3495,
            carat: value * 5,
          },
          kilogram: {
            milligram: value * 1e6,
            gram: value * 1000,
            kilogram: value,
            ton: value / 1000,
            megaton: value / 1e6,
            gigaton: value / 1e9,
            uston: value / 0.90718474,
            pound: value * 2.20462,
            ounce: value * 35.274,
            carat: value * 5000,
          },
          ton: {
            milligram: value * 1e9,
            gram: value * 1e6,
            kilogram: value * 1000,
            ton: value,
            megaton: value / 1000,
            gigaton: value / 1e6,
            uston: value * 1.10231,
            pound: value * 2204.62,
            ounce: value * 35274,
            carat: value * 5e6,
          },
          megaton: {
            milligram: value * 1e12,
            gram: value * 1e9,
            kilogram: value * 1e6,
            ton: value * 1000,
            megaton: value,
            gigaton: value / 1000,
            uston: value * 1.10231e3,
            pound: value * 2.20462e6,
            ounce: value * 3.5274e7,
            carat: value * 5e9,
          },
          gigaton: {
            milligram: value * 1e15,
            gram: value * 1e12,
            kilogram: value * 1e9,
            ton: value * 1e6,
            megaton: value * 1000,
            gigaton: value,
            uston: value * 1.10231e6,
            pound: value * 2.20462e9,
            ounce: value * 3.5274e10,
            carat: value * 5e12,
          },
          uston: {
            milligram: value * 907184740,
            gram: value * 907184.74,
            kilogram: value * 907.18474,
            ton: value * 0.90718474,
            megaton: value * 0.00090718474,
            gigaton: value * 9.0718474e-7,
            uston: value,
            pound: value * 2000,
            ounce: value * 32000,
            carat: value * 4.53592e6,
          },
          pound: {
            milligram: value * 453592.37,
            gram: value * 453.59237,
            kilogram: value / 2.20462,
            ton: value / 2204.62,
            megaton: value / 2.20462e6,
            gigaton: value / 2.20462e9,
            uston: value / 2000,
            pound: value,
            ounce: value * 16,
            carat: value * 2267.96,
          },
          ounce: {
            milligram: value * 28349.5,
            gram: value * 28.3495,
            kilogram: value / 35.274,
            ton: value / 35274,
            megaton: value / 3.5274e7,
            gigaton: value / 3.5274e10,
            uston: value / 32000,
            pound: value / 16,
            ounce: value,
            carat: value * 141.7475,
          },
          carat: {
            milligram: value * 200,
            gram: value / 5,
            kilogram: value / 5000,
            ton: value / 5e6,
            megaton: value / 5e9,
            gigaton: value / 5e12,
            uston: value / 4.53592e6,
            pound: value / 2267.96,
            ounce: value / 141.7475,
            carat: value,
          }
        };
      
        return conversions[name];
    };
    
    const handleChangeWeightUnits = (e) => {
        const { name, value } = e.target;
        
        if (!isNaN(value) && value !== '') {
            const newValues = convertValues(name, parseFloat(value));
            setValues({
                milligram: parseFloat(newValues.milligram.toString()),
                gram: parseFloat(newValues.gram.toString()),
                kilogram: parseFloat(newValues.kilogram.toString()),
                ton: parseFloat(newValues.ton.toString()),
                megaton: parseFloat(newValues.megaton.toString()),
                gigaton: parseFloat(newValues.gigaton.toString()),
                uston: parseFloat(newValues.uston.toString()),
                pound: parseFloat(newValues.pound.toString()),
                ounce: parseFloat(newValues.ounce.toString()),
                carat: parseFloat(newValues.carat.toString()),
            });
        } else {
            // If the input value is not a number or is empty, clear all the input fields
            setValues({
                milligram: '',
                gram: '',
                kilogram: '',
                ton: '',
                megaton: '',
                gigaton: '',
                uston: '',
                pound: '',
                ounce: '',
                carat: '',
            });
        }
    };

    // Function to clear all fields
    const handleClearFields = () => {
      setValues({
          milligram: '',
          gram: '',
          kilogram: '',
          ton: '',
          megaton: '',
          gigaton: '',
          uston: '',
          pound: '',
          ounce: '',
          carat: '',
      });
    };
    
  
  return (
    <div className='convertersMainArea'>
        <h4>WEIGHT UNITS CONVERTER</h4>
        <div>
            <input type='number' className='input101' value={values.milligram} 
                name='milligram' onChange={handleChangeWeightUnits} /> <label>Milligram</label> <br/>
            <input type='number' className='input101' value={values.gram} 
                name='gram' onChange={handleChangeWeightUnits} /> <label>Gram</label> <br/>
            <input type='number' className='input101' value={values.kilogram} 
                name='kilogram' onChange={handleChangeWeightUnits} /> <label>Kilogram</label> <br/>
            <input type='number' className='input101' value={values.ton} 
                name='ton' onChange={handleChangeWeightUnits} /> <label>Ton</label> <br/>
            <input type='number' className='input101' value={values.megaton} 
                name='megaton' onChange={handleChangeWeightUnits} /> <label>Megaton</label> <br/>
            <input type='number' className='input101' value={values.gigaton} 
                name='gigaton' onChange={handleChangeWeightUnits} /> <label>Gigaton</label> <br/> 
            <input type='number' className='input101' value={values.uston} 
                name='uston' onChange={handleChangeWeightUnits} /> <label>U.S. ton</label> <br/>
            <input type='number' className='input101' value={values.pound} 
                name='pound' onChange={handleChangeWeightUnits} /> <label>Pound-lb.</label> <br/>
            <input type='number' className='input101' value={values.ounce} 
                name='ounce' onChange={handleChangeWeightUnits} /> <label>Ounce-oz.</label> <br/>
            <input type='number' className='input101' value={values.carat} 
                name='carat' onChange={handleChangeWeightUnits} /> <label>Carat</label> <br/><br/>
            <button className='button201' onClick={handleClearFields}>Clear</button>
        </div>
        <div> <br/><br/><br/><br/><br/><br/><br/> </div>
        <div> <CommentDisplay pageId={14}/></div>
    </div>
  )
}

export default Weight;
 