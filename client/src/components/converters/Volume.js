import React, { useState, useEffect } from 'react';
import axios from 'axios';
import "../../styles/converters.css"; 
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";

function Volume() {
    const pageIdVisitorPage = "unit_volume";
    useEffect(() => {
      const getData = async () => {
        try {
          // Send the request to log the visitor data without awaiting its completion
          axios.post(`/serversavevisitor/${pageIdVisitorPage}`, {}).catch((error) => {
            console.error('Error logging visit:', error.message);
          });
        } catch (error) {
          console.log(error.message);
        }
      };
      getData();
    }, []);


    const [values, setValues] = useState({
      cubicMillimeter: "",
      milliliter: "",
      cubicCentimeter: "",
      cubicMeter: "",
      liter: "",
      cubicInch: "",
      cubicFeet: "",
      cubicYard: "",
      gallonUS: "",
      gallonIMP: "",
      quartUS: "",
      quartIMP: "",
      pintUS: "",
      pintIMP: "",
      fluidOunceUS: "",
      fluidOunceIMP: "",
      cupUS: "",
      cupMET: "",
      cubicKilometer: "",
      barrel: "",
      teaspoon: "",
      tablespoon: "",
    })

    const convertValues = (name, value) => {
        const conversions = {
            cubicMillimeter: {
                cubicMillimeter: value,
                milliliter: value / 1000,
                cubicCentimeter: value / 1000,
                cubicMeter: value / 1e9,
                liter: value / 1e6,
                cubicInch: value / 16387.064,
                cubicFeet: value / 2.832e7,
                cubicYard: value / 7.646e8,
                gallonUS: value / 3.785e6,
                gallonIMP: value / 4.546e6,
                quartUS: value / 946352.946,
                quartIMP: value / 1136.52e3,
                pintUS: value / 473176.473,
                pintIMP: value / 568.261,
                fluidOunceUS: value / 29573.53,
                fluidOunceIMP: value / 28413.0625,
                cupUS: value / 236588.236,
                cupMET: value / 250000,
                cubicKilometer: value / 1e18,
                barrel: value / 1.589e8,
                teaspoon: value / 4928.922,
                tablespoon: value / 14786.766
            },
            milliliter: {
                cubicMillimeter: value * 1000,
                milliliter: value,
                cubicCentimeter: value,
                cubicMeter: value / 1e6,
                liter: value / 1000,
                cubicInch: value / 16.387064,
                cubicFeet: value / 28316.8466,
                cubicYard: value / 764554.858,
                gallonUS: value / 3785.41178,
                gallonIMP: value / 4546.09,
                quartUS: value / 946.352946,
                quartIMP: value / 1136.52,
                pintUS: value / 473.176473,
                pintIMP: value / 568.261,
                fluidOunceUS: value / 29.57353,
                fluidOunceIMP: value / 28.4130625,
                cupUS: value / 236.588236,
                cupMET: value / 250,
                cubicKilometer: value / 1e15,
                barrel: value / 158987.294,
                teaspoon: value / 4.928922,
                tablespoon: value / 14.786766
            },
            cubicCentimeter: {
                cubicMillimeter: value * 1000,
                milliliter: value,
                cubicCentimeter: value,
                cubicMeter: value / 1e6,
                liter: value / 1000,
                cubicInch: value / 16.387064,
                cubicFeet: value / 28316.8466,
                cubicYard: value / 764554.858,
                gallonUS: value / 3785.41178,
                gallonIMP: value / 4546.09,
                quartUS: value / 946.352946,
                quartIMP: value / 1136.52,
                pintUS: value / 473.176473,
                pintIMP: value / 568.261,
                fluidOunceUS: value / 29.57353,
                fluidOunceIMP: value / 28.4130625,
                cupUS: value / 236.588236,
                cupMET: value / 250,
                cubicKilometer: value / 1e15,
                barrel: value / 158987.294,
                teaspoon: value / 4.928922,
                tablespoon: value / 14.786766
            },
            cubicMeter: {
                cubicMillimeter: value * 1e9,
                milliliter: value * 1e6,
                cubicCentimeter: value * 1e6,
                cubicMeter: value,
                liter: value * 1000,
                cubicInch: value * 61023.7441,
                cubicFeet: value * 35.3146667,
                cubicYard: value * 1.30795062,
                gallonUS: value * 264.172052,
                gallonIMP: value * 219.969248,
                quartUS: value * 1056.68821,
                quartIMP: value * 879.877,
                pintUS: value * 2113.37642,
                pintIMP: value * 1759.754,
                fluidOunceUS: value * 33814.0227,
                fluidOunceIMP: value * 35195.08,
                cupUS: value * 4226.75284,
                cupMET: value * 4000,
                cubicKilometer: value / 1e9,
                barrel: value * 6.28981,
                teaspoon: value * 202884.136,
                tablespoon: value * 67628.0454
            },
            liter: {
                cubicMillimeter: value * 1e6,
                milliliter: value * 1000,
                cubicCentimeter: value * 1000,
                cubicMeter: value / 1000,
                liter: value,
                cubicInch: value * 61.0237441,
                cubicFeet: value / 28.3168466,
                cubicYard: value / 764.554858,
                gallonUS: value / 3.78541178,
                gallonIMP: value / 4.54609,
                quartUS: value / 0.946352946,
                quartIMP: value / 1.13652,
                pintUS: value / 0.473176473,
                pintIMP: value / 0.568261,
                fluidOunceUS: value * 33.8140227,
                fluidOunceIMP: value * 35.19508,
                cupUS: value * 4.22675284,
                cupMET: value * 4,
                cubicKilometer: value / 1e12,
                barrel: value / 158.987294,
                teaspoon: value * 202.884136,
                tablespoon: value * 67.6280454
            },
            cubicInch: {
                cubicMillimeter: value * 16387.064,
                milliliter: value * 16.387064,
                cubicCentimeter: value * 16.387064,
                cubicMeter: value / 61023.7441,
                liter: value / 61.0237441,
                cubicInch: value,
                cubicFeet: value / 1728,
                cubicYard: value / 46656,
                gallonUS: value / 231,
                gallonIMP: value / 277.419432,
                quartUS: value / 57.75,
                quartIMP: value / 69.354858,
                pintUS: value / 28.875,
                pintIMP: value / 34.677429,
                fluidOunceUS: value * 0.554112554,
                fluidOunceIMP: value * 0.576744,
                cupUS: value / 14.4375,
                cupMET: value / 15.7725,
                cubicKilometer: value / 6.102e13,
                barrel: value / 9702,
                teaspoon: value * 3.32468,
                tablespoon: value * 1.10823
            },
            cubicFeet: {
                cubicMillimeter: value * 2.832e7,
                milliliter: value * 28316.8466,
                cubicCentimeter: value * 28316.8466,
                cubicMeter: value / 35.3146667,
                liter: value * 28.3168466,
                cubicInch: value * 1728,
                cubicFeet: value,
                cubicYard: value / 27,
                gallonUS: value * 7.48052,
                gallonIMP: value * 6.228835,
                quartUS: value * 29.9221,
                quartIMP: value * 24.91534,
                pintUS: value * 59.84421,
                pintIMP: value * 49.83068,
                fluidOunceUS: value * 957.506,
                fluidOunceIMP: value * 996.612,
                cupUS: value * 119.688,
                cupMET: value * 113.4,
                cubicKilometer: value / 3.531e10,
                barrel: value * 0.1781,
                teaspoon: value * 67628.05,
                tablespoon: value * 22542.68
            },
            cubicYard: {
                cubicMillimeter: value * 7.646e8,
                milliliter: value * 764554.858,
                cubicCentimeter: value * 764554.858,
                cubicMeter: value / 1.30795062,
                liter: value * 764.554858,
                cubicInch: value * 46656,
                cubicFeet: value * 27,
                cubicYard: value,
                gallonUS: value * 201.974,
                gallonIMP: value * 168.179,
                quartUS: value * 807.897,
                quartIMP: value * 672.716,
                pintUS: value * 1615.794,
                pintIMP: value * 1345.433,
                fluidOunceUS: value * 25852.7,
                fluidOunceIMP: value * 21527,
                cupUS: value * 1940,
                cupMET: value * 3058,
                cubicKilometer: value / 7.646e9,
                barrel: value * 6.21,
                teaspoon: value * 1533276,
                tablespoon: value * 511093
            },
            quartUS: {
                cubicMillimeter: value * 946352.946,
                milliliter: value * 946.352946,
                cubicCentimeter: value * 946.352946,
                cubicMeter: value / 1056.68821,
                liter: value / 1.05668821,
                cubicInch: value * 57.75,
                cubicFeet: value / 29.9221,
                cubicYard: value / 807.897,
                gallonUS: value / 4,
                gallonIMP: value / 4.804,
                quartUS: value,
                quartIMP: value / 1.20095,
                pintUS: value * 2,
                pintIMP: value * 1.66535,
                fluidOunceUS: value * 32,
                fluidOunceIMP: value * 33.307,
                cupUS: value * 4,
                cupMET: value * 4.22675,
                cubicKilometer: value / 1.057e12,
                barrel: value / 119.241,
                teaspoon: value * 192,
                tablespoon: value * 64
            },
            quartIMP: {
                cubicMillimeter: value * 1.137e6,
                milliliter: value * 1136.52,
                cubicCentimeter: value * 1136.52,
                cubicMeter: value / 879.877,
                liter: value / 0.879877,
                cubicInch: value * 69.354858,
                cubicFeet: value / 24.91534,
                cubicYard: value / 672.716,
                gallonUS: value / 3.331,
                gallonIMP: value / 4,
                quartUS: value * 1.20095,
                quartIMP: value,
                pintUS: value * 2.4019,
                pintIMP: value * 2,
                fluidOunceUS: value * 38.4304,
                fluidOunceIMP: value * 40,
                cupUS: value * 4.8038,
                cupMET: value * 4.543,
                cubicKilometer: value / 1.137e12,
                barrel: value / 163.659,
                teaspoon: value * 230.4,
                tablespoon: value * 76.8
            },
            pintUS: {
                cubicMillimeter: value * 473176.473,
                milliliter: value * 473.176473,
                cubicCentimeter: value * 473.176473,
                cubicMeter: value / 2113.37642,
                liter: value / 2.11337642,
                cubicInch: value * 28.875,
                cubicFeet: value / 59.8442,
                cubicYard: value / 1615.794,
                gallonUS: value / 8,
                gallonIMP: value / 9.60762,
                quartUS: value / 2,
                quartIMP: value / 4.8038,
                pintUS: value,
                pintIMP: value / 1.20095,
                fluidOunceUS: value * 16,
                fluidOunceIMP: value * 16.6535,
                cupUS: value * 2,
                cupMET: value * 2.11338,
                cubicKilometer: value / 2.113e12,
                barrel: value / 238.482,
                teaspoon: value * 96,
                tablespoon: value * 32
            },
            pintIMP: {
                cubicMillimeter: value * 568261,
                milliliter: value * 568.261,
                cubicCentimeter: value * 568.261,
                cubicMeter: value / 1759.754,
                liter: value / 1.759754,
                cubicInch: value * 34.6774,
                cubicFeet: value / 49.83068,
                cubicYard: value / 1345.433,
                gallonUS: value / 7.6846,
                gallonIMP: value / 8,
                quartUS: value / 1.66535,
                quartIMP: value / 2,
                pintUS: value * 1.20095,
                pintIMP: value,
                fluidOunceUS: value * 19.2152,
                fluidOunceIMP: value * 20,
                cupUS: value * 2.4019,
                cupMET: value * 2.2715,
                cubicKilometer: value / 1.759e12,
                barrel: value / 327.319,
                teaspoon: value * 115.2,
                tablespoon: value * 38.4
            },
            fluidOunceUS: {
                cubicMillimeter: value * 29573.53,
                milliliter: value * 29.57353,
                cubicCentimeter: value * 29.57353,
                cubicMeter: value / 33814.0227,
                liter: value / 33.8140227,
                cubicInch: value * 1.80469,
                cubicFeet: value / 957.506,
                cubicYard: value / 25852.7,
                gallonUS: value / 128,
                gallonIMP: value / 153.722,
                quartUS: value / 32,
                quartIMP: value / 38.4304,
                pintUS: value / 16,
                pintIMP: value / 19.2152,
                fluidOunceUS: value,
                fluidOunceIMP: value / 1.04084,
                cupUS: value / 8,
                cupMET: value / 8.45351,
                cubicKilometer: value / 3.814e10,
                barrel: value / 5376,
                teaspoon: value * 6,
                tablespoon: value * 2
            },
            fluidOunceIMP: {
                cubicMillimeter: value * 28413.0625,
                milliliter: value * 28.4130625,
                cubicCentimeter: value * 28.4130625,
                cubicMeter: value / 35195.08,
                liter: value / 35.19508,
                cubicInch: value * 1.73387,
                cubicFeet: value / 996.612,
                cubicYard: value / 21527,
                gallonUS: value / 153.722,
                gallonIMP: value / 160,
                quartUS: value / 38.4304,
                quartIMP: value / 40,
                pintUS: value / 19.2152,
                pintIMP: value / 20,
                fluidOunceUS: value * 1.04084,
                fluidOunceIMP: value,
                cupUS: value / 9.60762,
                cupMET: value / 8.805,
                cubicKilometer: value / 3.514e10,
                barrel: value / 6144,
                teaspoon: value * 4.8,
                tablespoon: value * 1.6
            },
            cupUS: {
                cubicMillimeter: value * 236588.236,
                milliliter: value * 236.588236,
                cubicCentimeter: value * 236.588236,
                cubicMeter: value / 4226.75284,
                liter: value / 4.22675284,
                cubicInch: value * 14.4375,
                cubicFeet: value / 119.688,
                cubicYard: value / 1940,
                gallonUS: value / 16,
                gallonIMP: value / 19.2152,
                quartUS: value / 4,
                quartIMP: value / 4.8038,
                pintUS: value / 2,
                pintIMP: value / 2.4019,
                fluidOunceUS: value * 8,
                fluidOunceIMP: value * 8.32675,
                cupUS: value,
                cupMET: value / 1.05669,
                cubicKilometer: value / 4.227e12,
                barrel: value / 952,
                teaspoon: value * 48,
                tablespoon: value * 16
            },
            cupMET: {
                cubicMillimeter: value * 250000,
                milliliter: value * 250,
                cubicCentimeter: value * 250,
                cubicMeter: value / 4000,
                liter: value / 4,
                cubicInch: value * 15.7725,
                cubicFeet: value / 113.4,
                cubicYard: value / 3058,
                gallonUS: value / 15.7725,
                gallonIMP: value / 17.598,
                quartUS: value / 3.94314,
                quartIMP: value / 4.3995,
                pintUS: value / 1.97157,
                pintIMP: value / 2.19977,
                fluidOunceUS: value * 8.45351,
                fluidOunceIMP: value * 8.8,
                cupUS: value * 1.05669,
                cupMET: value,
                cubicKilometer: value / 4e12,
                barrel: value / 1000,
                teaspoon: value * 50,
                tablespoon: value * 16.6667
            },
            cubicKilometer: {
                cubicMillimeter: value * 1e18,
                milliliter: value * 1e15,
                cubicCentimeter: value * 1e15,
                cubicMeter: value * 1e9,
                liter: value * 1e12,
                cubicInch: value * 6.102e13,
                cubicFeet: value * 3.531e10,
                cubicYard: value * 1.308e9,
                gallonUS: value * 2.642e11,
                gallonIMP: value * 2.2e11,
                quartUS: value * 1.0567e12,
                quartIMP: value * 8.8e11,
                pintUS: value * 2.113e12,
                pintIMP: value * 1.76e12,
                fluidOunceUS: value * 3.3814e13,
                fluidOunceIMP: value * 3.5195e13,
                cupUS: value * 4.227e12,
                cupMET: value * 4e12,
                cubicKilometer: value,
                barrel: value * 6.29e9,
                teaspoon: value * 2.029e14,
                tablespoon: value * 6.763e13
            },
            barrel: {
                cubicMillimeter: value * 1.589e8,
                milliliter: value * 158987.294,
                cubicCentimeter: value * 158987.294,
                cubicMeter: value / 6.28981,
                liter: value * 158.987294,
                cubicInch: value * 9702,
                cubicFeet: value * 5.61458,
                cubicYard: value * 0.207948,
                gallonUS: value * 42,
                gallonIMP: value * 34.9723,
                quartUS: value * 168,
                quartIMP: value * 139.889,
                pintUS: value * 336,
                pintIMP: value * 279.778,
                fluidOunceUS: value * 5376,
                fluidOunceIMP: value * 4476.45,
                cupUS: value * 672,
                cupMET: value * 635.949,
                cubicKilometer: value / 1.589e8,
                barrel: value,
                teaspoon: value * 324000,
                tablespoon: value * 108000
            },
            teaspoon: {
                cubicMillimeter: value * 4928.922,
                milliliter: value * 4.928922,
                cubicCentimeter: value * 4.928922,
                cubicMeter: value / 202884.136,
                liter: value / 202.884136,
                cubicInch: value * 0.300781,
                cubicFeet: value / 67628.0454,
                cubicYard: value / 1.533e6,
                gallonUS: value / 768,
                gallonIMP: value / 922.331,
                quartUS: value / 192,
                quartIMP: value / 230.583,
                pintUS: value / 96,
                pintIMP: value / 115.292,
                fluidOunceUS: value / 6,
                fluidOunceIMP: value / 4.8,
                cupUS: value / 48,
                cupMET: value / 50,
                cubicKilometer: value / 4.929e15,
                barrel: value / 324000,
                teaspoon: value,
                tablespoon: value / 3
            },
            tablespoon: {
                cubicMillimeter: value * 14786.766,
                milliliter: value * 14.786766,
                cubicCentimeter: value * 14.786766,
                cubicMeter: value / 67628.0454,
                liter: value / 67.6280454,
                cubicInch: value * 0.902344,
                cubicFeet: value / 22542.6818,
                cubicYard: value / 608232.033,
                gallonUS: value / 256,
                gallonIMP: value / 307.444,
                quartUS: value / 64,
                quartIMP: value / 76.8611,
                pintUS: value / 32,
                pintIMP: value / 38.4306,
                fluidOunceUS: value / 2,
                fluidOunceIMP: value / 1.6,
                cupUS: value / 16,
                cupMET: value / 16.6667,
                cubicKilometer: value / 1.479e15,
                barrel: value / 108000,
                teaspoon: value * 3,
                tablespoon: value
            }
        };
    
        return conversions[name];
    };
    
  
    
  const handleChangeVolumeUnits = (e) => {
    const { name, value } = e.target;

    if (!isNaN(value) && value !== '') {
        const newValues = convertValues(name, parseFloat(value));
        setValues({
            cubicMillimeter: parseFloat(newValues.cubicMillimeter.toString()),
            milliliter: parseFloat(newValues.milliliter.toString()),
            cubicCentimeter: parseFloat(newValues.cubicCentimeter.toString()),
            cubicMeter: parseFloat(newValues.cubicMeter.toString()),
            liter: parseFloat(newValues.liter.toString()),
            cubicInch: parseFloat(newValues.cubicInch.toString()),
            cubicFeet: parseFloat(newValues.cubicFeet.toString()),
            cubicYard: parseFloat(newValues.cubicYard.toString()),
            gallonUS: parseFloat(newValues.gallonUS.toString()),
            gallonIMP: parseFloat(newValues.gallonIMP.toString()),
            quartUS: parseFloat(newValues.quartUS.toString()),
            quartIMP: parseFloat(newValues.quartIMP.toString()),
            pintUS: parseFloat(newValues.pintUS.toString()),
            pintIMP: parseFloat(newValues.pintIMP.toString()),
            fluidOunceUS: parseFloat(newValues.fluidOunceUS.toString()),
            fluidOunceIMP: parseFloat(newValues.fluidOunceIMP.toString()),
            cupUS: parseFloat(newValues.cupUS.toString()),
            cupMET: parseFloat(newValues.cupMET.toString()),
            cubicKilometer: parseFloat(newValues.cubicKilometer.toString()),
            barrel: parseFloat(newValues.barrel.toString()),
            teaspoon: parseFloat(newValues.teaspoon.toString()),
            tablespoon: parseFloat(newValues.tablespoon.toString()),
        });
      } else {
        setValues({
            cubicMillimeter: "",
            milliliter: "",
            cubicCentimeter: "",
            cubicMeter: "",
            liter: "",
            cubicInch: "",
            cubicFeet: "",
            cubicYard: "",
            gallonUS: "",
            gallonIMP: "",
            quartUS: "",
            quartIMP: "",
            pintUS: "",
            pintIMP: "",
            fluidOunceUS: "",
            fluidOunceIMP: "",
            cupUS: "",
            cupMET: "",
            cubicKilometer: "",
            barrel: "",
            teaspoon: "",
            tablespoon: "",
        });
      }
    };


    // Function to clear all fields
    const handleClearFields = () => {
      setValues({
        cubicMillimeter: "",
        milliliter: "",
        cubicCentimeter: "",
        cubicMeter: "",
        liter: "",
        cubicInch: "",
        cubicFeet: "",
        cubicYard: "",
        gallonUS: "",
        gallonIMP: "",
        quartUS: "",
        quartIMP: "",
        pintUS: "",
        pintIMP: "",
        fluidOunceUS: "",
        fluidOunceIMP: "",
        cupUS: "",
        cupMET: "",
        cubicKilometer: "",
        barrel: "",
        teaspoon: "",
        tablespoon: "",
      });
    };

  return (
    <>
        <div className='convertersMainArea'>
            <h4>VOLUME UNITS CONVERTER</h4>
            <div>
                <input type='number' className='input103' value={values.cubicMillimeter} 
                    name='cubicMillimeter' onChange={handleChangeVolumeUnits} /> <label>Cubic Millimeter (mm³)</label> <br/>
                <input type='number' className='input103' value={values.milliliter} 
                    name='milliliter' onChange={handleChangeVolumeUnits} /> <label>Milliliter (mL)</label> <br/>
                <input type='number' className='input103' value={values.cubicCentimeter} 
                    name='cubicCentimeter' onChange={handleChangeVolumeUnits} /> <label>Cubic Centimeter (cm³)</label> <br/>
                <input type='number' className='input103' value={values.liter} 
                    name='liter' onChange={handleChangeVolumeUnits} /> <label>Liter (L)</label> <br/>
                <input type='number' className='input103' value={values.cubicMeter} 
                    name='cubicMeter' onChange={handleChangeVolumeUnits} /> <label>Cubic Meter (m³)</label> <br/>
                <input type='number' className='input103' value={values.cubicKilometer} 
                    name='cubicKilometer' onChange={handleChangeVolumeUnits} /> <label>Cubic Kilometer (km³)</label> <br/>
                <input type='number' className='input103' value={values.cubicInch} 
                    name='cubicInch' onChange={handleChangeVolumeUnits} /> <label>Cubic Inch (in³)</label> <br/> 
                <input type='number' className='input103' value={values.cubicFeet} 
                    name='cubicFeet' onChange={handleChangeVolumeUnits} /> <label>Cubic Feet (ft³)</label> <br/> 
                <input type='number' className='input103' value={values.cubicYard} 
                    name='cubicYard' onChange={handleChangeVolumeUnits} /> <label>Cubic Yard (yd³)</label> <br/>
                <input type='number' className='input103' value={values.gallonUS} 
                    name='gallonUS' onChange={handleChangeVolumeUnits} /> <label>Gallon (US)</label> <br/>
                <input type='number' className='input103' value={values.gallonIMP} 
                    name='gallonIMP' onChange={handleChangeVolumeUnits} /> <label>Gallon (Imperial)</label> <br/>
                <input type='number' className='input103' value={values.quartUS} 
                    name='quartUS' onChange={handleChangeVolumeUnits} /> <label>Quart (US)</label> <br/>
                <input type='number' className='input103' value={values.quartIMP} 
                    name='quartIMP' onChange={handleChangeVolumeUnits} /> <label>Quart (Imperial)</label> <br/>
                <input type='number' className='input103' value={values.pintUS} 
                    name='pintUS' onChange={handleChangeVolumeUnits} /> <label>Pint (US)</label> <br/>
                <input type='number' className='input103' value={values.pintIMP} 
                    name='pintIMP' onChange={handleChangeVolumeUnits} /> <label>Pint (US)</label> <br/>
                <input type='number' className='input103' value={values.fluidOunceUS} 
                    name='fluidOunceUS' onChange={handleChangeVolumeUnits} /> <label>Fluid Ounce (US)</label> <br/>
                <input type='number' className='input103' value={values.fluidOunceIMP} 
                    name='fluidOunceIMP' onChange={handleChangeVolumeUnits} /> <label>Fluid Ounce (Imperial)</label> <br/>
                <input type='number' className='input103' value={values.cupUS} 
                    name='cupUS' onChange={handleChangeVolumeUnits} /> <label>Cup (US)</label> <br/>
                <input type='number' className='input103' value={values.cupMET} 
                    name='cupMET' onChange={handleChangeVolumeUnits} /> <label>Cup (Metric)</label> <br/>
                <input type='number' className='input103' value={values.barrel} 
                    name='barrel' onChange={handleChangeVolumeUnits} /> <label>Barrel (Oil)</label> <br/>
                <input type='number' className='input103' value={values.teaspoon} 
                    name='teaspoon' onChange={handleChangeVolumeUnits} /> <label>Teaspoon (tsp)</label> <br/>
                <input type='number' className='input103' value={values.tablespoon} 
                    name='tablespoon' onChange={handleChangeVolumeUnits} /> <label>Tablespoon (tbsp)</label> <br/> <br/>
                <button className='button201' onClick={handleClearFields}>Clear</button>
            </div>
            <div> <br/><br/><br/><br/><br/><br/><br/> </div>
        </div>
        <div> <CommentDisplay pageId={18}/></div>
        <div> <br/><br/><br/> <Footer /> </div>
    </>

  )
}

export default Volume;
  