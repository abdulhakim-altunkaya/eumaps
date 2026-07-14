import React from 'react'
import CommentDisplay from '../CommentDisplay';

function IndexComp() {
  return (
    <div className='homepageArea'>
        <h1>EUMAPS.ORG</h1>
        <h3>Gümrük Hesaplama Platformu</h3>
        <div> <CommentDisplay pageId={5}/></div>
    </div> 
  )
}

export default IndexComp