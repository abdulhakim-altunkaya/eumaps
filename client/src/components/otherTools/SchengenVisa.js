import React, { useState } from 'react';
import "../../styles/otherTools.css"; 

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
      const tripStartDate = new Date(trip.entryDate);
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
    <div>
      <h2>Schengen Visa Calculator (90/180 days)</h2>
      <div>
        <label>
          Entry Date:
          <input 
            type="date" 
            value={entryDate} 
            onChange={(e) => setEntryDate(e.target.value)} 
          />
        </label>
        <label>
          Exit Date:
          <input 
            type="date" 
            value={exitDate} 
            onChange={(e) => setExitDate(e.target.value)} 
          />
        </label>
        <button onClick={addTrip} className='button_plus'></button>
      </div>
      <div>
        <h3>Travel History</h3>
        <ul>
          {trips.map((trip, index) => (
            <li key={index}>
              From {trip.entryDate} to {trip.exitDate} ({trip.duration} days)
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3>Remaining Days</h3>
        {remainingDays > 0 ? (
          <p>You have {remainingDays} days remaining in your Schengen visa period.</p>
        ) : (
          <p>Warning: You have exceeded your Schengen visa stay.</p>
        )}
      </div>
    </div>
  );
};

export default SchengenVisa;
