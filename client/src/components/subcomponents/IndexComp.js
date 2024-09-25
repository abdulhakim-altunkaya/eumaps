import React from 'react'
import Comment from '../Comment';

function IndexComp() {
  return (
    <div className='homepageArea'>
        <h1>WELCOME TO EUMAPS</h1>
        <p>Platform of Useful Applications and Calculators</p>
        <div> <Comment pageId={1}/> </div>
    </div>
  )
}

export default IndexComp