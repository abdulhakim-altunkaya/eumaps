import React, { useState, useEffect } from 'react';
import axios from 'axios';
import "../../styles/converters.css"; 
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";

function Time() {
    const pageIdVisitorPage = "unit_time";
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
        nanosecond: "",
        microsecond: "",
        millisecond: "",
        second: "",
        minute: "",
        hour: "",
        day: "",
        week: "",
        month: "",
        year: "",
        decade: "",
        century: "",
        julianYear: "",
        siderealYear: "", 
        planckTime: "",
        fortnight: "",
    });

    const convertValues = (name, value) => {
        const conversions = {
            nanosecond: {
                nanosecond: value,
                microsecond: value / 1e3,
                millisecond: value / 1e6,
                second: value / 1e9,
                minute: value / 6e10,
                hour: value / 3.6e12,
                day: value / 8.64e13,
                week: value / 6.048e14,
                month: value / 2.628e15, // Assuming 30.44 days per month (average)
                year: value / 3.154e16,
                decade: value / 3.154e17,
                century: value / 3.154e18,
                julianYear: value / 3.15576e16,
                siderealYear: value / 3.15581498e16,
                planckTime: value / 5.391e-44,
                fortnight: value / 1.2096e15
            },
            microsecond: {
                nanosecond: value * 1e3,
                microsecond: value,
                millisecond: value / 1e3,
                second: value / 1e6,
                minute: value / 6e7,
                hour: value / 3.6e9,
                day: value / 8.64e10,
                week: value / 6.048e11,
                month: value / 2.628e12,
                year: value / 3.154e13,
                decade: value / 3.154e14,
                century: value / 3.154e15,
                julianYear: value / 3.15576e13,
                siderealYear: value / 3.15581498e13,
                planckTime: value / 5.391e-41,
                fortnight: value / 1.2096e12
            },
            millisecond: {
                nanosecond: value * 1e6,
                microsecond: value * 1e3,
                millisecond: value,
                second: value / 1e3,
                minute: value / 6e4,
                hour: value / 3.6e6,
                day: value / 8.64e7,
                week: value / 6.048e8,
                month: value / 2.628e9,
                year: value / 3.154e10,
                decade: value / 3.154e11,
                century: value / 3.154e12,
                julianYear: value / 3.15576e10,
                siderealYear: value / 3.15581498e10,
                planckTime: value / 5.391e-38,
                fortnight: value / 1.2096e9
            },
            second: {
                nanosecond: value * 1e9,
                microsecond: value * 1e6,
                millisecond: value * 1e3,
                second: value,
                minute: value / 60,
                hour: value / 3600,
                day: value / 86400,
                week: value / 604800,
                month: value / 2.628e6,
                year: value / 3.154e7,
                decade: value / 3.154e8,
                century: value / 3.154e9,
                julianYear: value / 3.15576e7,
                siderealYear: value / 3.15581498e7,
                planckTime: value / 5.391e-35,
                fortnight: value / 1.2096e6
            },
            minute: {
                nanosecond: value * 6e10,
                microsecond: value * 6e7,
                millisecond: value * 6e4,
                second: value * 60,
                minute: value,
                hour: value / 60,
                day: value / 1440,
                week: value / 10080,
                month: value / 43800,  // Assuming 30.44 days per month
                year: value / 525600,
                decade: value / 5.256e6,
                century: value / 5.256e7,
                julianYear: value / 525960,
                siderealYear: value / 525964.663,
                planckTime: value / 3.2346e-33,
                fortnight: value / 20160
            },
            hour: {
                nanosecond: value * 3.6e12,
                microsecond: value * 3.6e9,
                millisecond: value * 3.6e6,
                second: value * 3600,
                minute: value * 60,
                hour: value,
                day: value / 24,
                week: value / 168,
                month: value / 730.001,  // Assuming 30.44 days per month
                year: value / 8760,
                decade: value / 87600,
                century: value / 876000,
                julianYear: value / 8766,
                siderealYear: value / 8766.077,
                planckTime: value / 1.94076e-31,
                fortnight: value / 336
            },
            day: {
                nanosecond: value * 8.64e13,
                microsecond: value * 8.64e10,
                millisecond: value * 8.64e7,
                second: value * 86400,
                minute: value * 1440,
                hour: value * 24,
                day: value,
                week: value / 7,
                month: value / 30.44,
                year: value / 365.25,
                decade: value / 3652.5,
                century: value / 36525,
                julianYear: value / 365.25,
                siderealYear: value / 365.256363,
                planckTime: value / 4.662e-30,
                fortnight: value / 14
            },
            week: {
                nanosecond: value * 6.048e14,
                microsecond: value * 6.048e11,
                millisecond: value * 6.048e8,
                second: value * 604800,
                minute: value * 10080,
                hour: value * 168,
                day: value * 7,
                week: value,
                month: value / 4.345,
                year: value / 52.1786,
                decade: value / 521.786,
                century: value / 5217.86,
                julianYear: value / 52.1786,
                siderealYear: value / 52.179,
                planckTime: value / 3.2637e-28,
                fortnight: value / 2
            },
            month: {
                nanosecond: value * 2.628e15,
                microsecond: value * 2.628e12,
                millisecond: value * 2.628e9,
                second: value * 2.628e6,
                minute: value * 43800,
                hour: value * 730.001,
                day: value * 30.44,
                week: value * 4.345,
                month: value,
                year: value / 12,
                decade: value / 120,
                century: value / 1200,
                julianYear: value / 12,
                siderealYear: value / 12.002,
                planckTime: value / 1.2285e-26,
                fortnight: value / 2.174
            },
            year: {
                nanosecond: value * 3.154e16,
                microsecond: value * 3.154e13,
                millisecond: value * 3.154e10,
                second: value * 3.154e7,
                minute: value * 525600,
                hour: value * 8760,
                day: value * 365.25,
                week: value * 52.1786,
                month: value * 12,
                year: value,
                decade: value / 10,
                century: value / 100,
                julianYear: value,
                siderealYear: value / 1.00002,
                planckTime: value / 3.8866e-25,
                fortnight: value * 26.089
            },
            decade: {
                nanosecond: value * 3.154e17,
                microsecond: value * 3.154e14,
                millisecond: value * 3.154e11,
                second: value * 3.154e8,
                minute: value * 5.256e6,
                hour: value * 87600,
                day: value * 3652.5,
                week: value * 521.786,
                month: value * 120,
                year: value * 10,
                decade: value,
                century: value / 10,
                julianYear: value * 10,
                siderealYear: value * 9.99979,
                planckTime: value / 3.8866e-24,
                fortnight: value * 260.89
            },
            century: {
                nanosecond: value * 3.154e18,
                microsecond: value * 3.154e15,
                millisecond: value * 3.154e12,
                second: value * 3.154e9,
                minute: value * 5.256e7,
                hour: value * 876000,
                day: value * 36525,
                week: value * 5217.86,
                month: value * 1200,
                year: value * 100,
                decade: value * 10,
                century: value,
                julianYear: value * 100,
                siderealYear: value * 99.9979,
                planckTime: value / 3.8866e-23,
                fortnight: value * 2608.9
            },
            julianYear: {
                nanosecond: value * 3.15576e16,
                microsecond: value * 3.15576e13,
                millisecond: value * 3.15576e10,
                second: value * 3.15576e7,
                minute: value * 525960,
                hour: value * 8766,
                day: value * 365.25,
                week: value * 52.1786,
                month: value * 12,
                year: value,
                decade: value / 10,
                century: value / 100,
                julianYear: value,
                siderealYear: value / 1.00002,
                planckTime: value / 3.8866e-25,
                fortnight: value * 26.089
            },
            siderealYear: {
                nanosecond: value * 3.15581498e16,
                microsecond: value * 3.15581498e13,
                millisecond: value * 3.15581498e10,
                second: value * 3.15581498e7,
                minute: value * 525964.663,
                hour: value * 8766.077,
                day: value * 365.256363,
                week: value * 52.179,
                month: value * 12.002,
                year: value * 1.00002,
                decade: value / 10,
                century: value / 100,
                julianYear: value * 1.00002,
                siderealYear: value,
                planckTime: value / 3.8869e-25,
                fortnight: value * 26.089
            },
            planckTime: {
                nanosecond: value * 5.391e-44,
                microsecond: value * 5.391e-41,
                millisecond: value * 5.391e-38,
                second: value * 5.391e-35,
                minute: value * 8.985e-34,
                hour: value * 1.4975e-32,
                day: value * 3.59399e-31,
                week: value * 2.51579e-30,
                month: value * 8.2283e-30,
                year: value * 1.7081e-29,
                decade: value * 1.7081e-28,
                century: value * 1.7081e-27,
                julianYear: value * 1.7081e-29,
                siderealYear: value * 1.7081e-29,
                planckTime: value,
                fortnight: value * 2.619e-29
            },
            fortnight: {
                nanosecond: value * 1.2096e15,
                microsecond: value * 1.2096e12,
                millisecond: value * 1.2096e9,
                second: value * 1.2096e6,
                minute: value * 20160,
                hour: value * 336,
                day: value * 14,
                week: value * 2,
                month: value * 0.458333,
                year: value / 26.089,
                decade: value / 260.89,
                century: value / 2608.9,
                julianYear: value / 26.089,
                siderealYear: value / 26.089,
                planckTime: value / 3.815e28,
                fortnight: value
            }
        };
    
        return conversions[name];
    };
    
    
    const handleChangeTimeUnits = (e) => {
        const { name, value } = e.target;
        
        if (!isNaN(value) && value !== '') {
            const newValues = convertValues(name, parseFloat(value));
            setValues({
                nanosecond: parseFloat(newValues.nanosecond.toString()),
                microsecond: parseFloat(newValues.microsecond.toString()),
                millisecond: parseFloat(newValues.millisecond.toString()),
                second: parseFloat(newValues.second.toString()),
                minute: parseFloat(newValues.minute.toString()),
                hour: parseFloat(newValues.hour.toString()),
                day: parseFloat(newValues.day.toString()),
                week: parseFloat(newValues.week.toString()),
                month: parseFloat(newValues.month.toString()),
                year: parseFloat(newValues.year.toString()),
                decade: parseFloat(newValues.decade.toString()),
                century: parseFloat(newValues.century.toString()),
                julianYear: parseFloat(newValues.julianYear.toString()),
                siderealYear: parseFloat(newValues.siderealYear.toString()),
                planckTime: parseFloat(newValues.planckTime.toString()),
                fortnight: parseFloat(newValues.fortnight.toString()),
            });
        } else {
            // If the input value is not a number or is empty, clear all the input fields
            setValues({
                nanosecond: "",
                microsecond: "",
                millisecond: "",
                second: "",
                minute: "",
                hour: "",
                day: "",
                week: "",
                month: "",
                year: "",
                decade: "",
                century: "",
                julianYear: "",
                siderealYear: "",
                planckTime: "",
                fortnight: "",
            });
        }
    };

    // Function to clear all fields
    const handleClearFields = () => {
      setValues({
        nanosecond: "",
        microsecond: "",
        millisecond: "",
        second: "",
        minute: "",
        hour: "",
        day: "",
        week: "",
        month: "",
        year: "",
        decade: "",
        century: "",
        julianYear: "",
        siderealYear: "",
        planckTime: "",
        fortnight: "",
      });
    };
  
  return (
    <>
        <div className='convertersMainArea'>
            <h4>TIME UNITS CONVERTER</h4>
            <div>
                <input type='number' className='input103' value={values.nanosecond} 
                    name='nanosecond' onChange={handleChangeTimeUnits} /> <label>Nanoseconds (ns)</label> <br/>
                <input type='number' className='input103' value={values.microsecond} 
                    name='microsecond' onChange={handleChangeTimeUnits} /> <label>Microseconds (µs)</label> <br/>
                <input type='number' className='input103' value={values.millisecond} 
                    name='millisecond' onChange={handleChangeTimeUnits} /> <label>Milliseconds (ms)</label> <br/>
                <input type='number' className='input103' value={values.second} 
                    name='second' onChange={handleChangeTimeUnits} /> <label>Seconds (s)</label> <br/>
                <input type='number' className='input103' value={values.minute} 
                    name='minute' onChange={handleChangeTimeUnits} /> <label>Minutes (min)</label> <br/>
                <input type='number' className='input103' value={values.hour} 
                    name='hour' onChange={handleChangeTimeUnits} /> <label>Hours (h)</label> <br/> 
                <input type='number' className='input103' value={values.day} 
                    name='day' onChange={handleChangeTimeUnits} /> <label>Days (d)</label> <br/>
                <input type='number' className='input103' value={values.week} 
                    name='week' onChange={handleChangeTimeUnits} /> <label>Weeks</label> <br/>
                <input type='number' className='input103' value={values.month} 
                    name='month' onChange={handleChangeTimeUnits} /> <label>Months</label> <br/>
                <input type='number' className='input103' value={values.year} 
                    name='year' onChange={handleChangeTimeUnits} /> <label>Years</label> <br/>
                <input type='number' className='input103' value={values.decade} 
                    name='decade' onChange={handleChangeTimeUnits} /> <label>Decades</label> <br/>
                <input type='number' className='input103' value={values.century} 
                    name='century' onChange={handleChangeTimeUnits} /> <label>Centuries</label> <br/>
                <input type='number' className='input103' value={values.julianYear}
                    name='julianYear' onChange={handleChangeTimeUnits} /> <label>Julian Year</label> <br/>
                <input type='number' className='input103' value={values.siderealYear}
                    name='siderealYear' onChange={handleChangeTimeUnits} /> <label>Sidereal Day</label> <br/>
                <input type='number' className='input103' value={values.planckTime}
                    name='planckTime' onChange={handleChangeTimeUnits} /> <label>Planck Time</label> <br/>
                <input type='number' className='input103' value={values.fortnight}
                    name='fortnight' onChange={handleChangeTimeUnits} /> <label>Fortnight</label> <br/><br/>
                <button className='button201' onClick={handleClearFields}>Clear</button>
            </div>
            <div> <br/><br/><br/><br/><br/><br/><br/> </div>
        </div>
        <div> <CommentDisplay pageId={19}/></div>
        <div> <br/><br/><br/> <Footer /> </div>
    </>

  )
}
export default Time;

