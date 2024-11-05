import React, { useState } from 'react';
import "../../styles/otherTools.css"; 
import "../../styles/converters.css"; 
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";

const SchengenVisa = () => {
  const [trips, setTrips] = useState([]);
  const [entryDate, setEntryDate] = useState('');
  const [exitDate, setExitDate] = useState('');

  const calculateDays = (startDate, endDate) => { 
    const start = new Date(startDate);
    const end = new Date(endDate);
    const timeDifference = end - start;
    return Math.ceil(timeDifference / (1000 * 60 * 60 * 24)) + 1; // Include both start and end day
  };

  const addTrip = () => {
    if (entryDate && exitDate && new Date(exitDate) >= new Date(entryDate)) {
      const newTrip = {
        entryDate,
        exitDate,
        duration: calculateDays(entryDate, exitDate)
      };
      setTrips([...trips, newTrip]);
      setEntryDate('');
      setExitDate('');
    } else {
      alert('Invalid dates. Please check your input.');
    }
  };

  const calculateDaysInLast180 = () => {
    const today = new Date();
    const daysInLast180 = trips.reduce((totalDays, trip) => {
      const tripEndDate = new Date(trip.exitDate);
      const daysInTrip = calculateDays(trip.entryDate, trip.exitDate);

      if (today - tripEndDate <= 180 * 24 * 60 * 60 * 1000) {
        return totalDays + daysInTrip;
      }
      return totalDays;
    }, 0);
    return daysInLast180;
  };

  const remainingDays = 90 - calculateDaysInLast180();

  return (
    <>
      <div className='convertersMainArea'>
        <h2>Schengen Visa Calculator (90/180 days)</h2>
        
        <div className='inputAreaContainer2'>
          <div className='flex-container'>
            <div className="date-input-wrapper">
              Entry Date:&nbsp;&nbsp;
              <input type="date" value={entryDate} className='dateInputAreas' onChange={(e) => setEntryDate(e.target.value)} />
              <img src="/icons/calendar1.png" className="custom-calendar-icon" alt="Calendar Icon" />
            </div>

            <div className="date-input-wrapper">
              Exit Date:&nbsp;&nbsp;
              <input type="date" value={exitDate} className='dateInputAreas' onChange={(e) => setExitDate(e.target.value)} />
              <img src="/icons/calendar1.png" className="custom-calendar-icon" alt="Calendar Icon" />
            </div>
          </div>&nbsp;&nbsp;&nbsp;&nbsp;
          <button onClick={addTrip} className='button_plus'></button>
        </div>
        
        <div>
          <ul>
            {trips.map((trip, index) => (
              <li key={index}>
                <span className='resultText1'>
                  {trip.entryDate} <FontAwesomeIcon icon={faArrowRight} className='arrowIcon' /> {trip.exitDate}
                </span>:&nbsp;&nbsp;&nbsp;&nbsp;{trip.duration} days
              </li>
            ))}
          </ul>
        </div>
        <div className='resultSchengenCalculator'>
          {remainingDays < 90 && <h3>Remaining Days</h3>}
          {remainingDays > 0 ? (
            <p>You have {remainingDays} days remaining in your Schengen visa period.</p>
          ) : (
            <p>Warning: You have exceeded your Schengen visa stay.</p>
          )}
        </div>
      </div>
      <div> <br/><br/><br/><br/><br/><br/><br/> </div>
      <div><CommentDisplay pageId={24}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </>

  );
};

export default SchengenVisa;
