import React, {useState} from 'react';

function SidebarNav() {

  const [converterToggle, setConverterToggle] = useState(false);
  const [wordToolsToggle, setWordToolsToggle] = useState(false);

  const toggleConverters = () => {
    setConverterToggle(!converterToggle);
  }

  const toggleWordTools = () => {
    setWordToolsToggle(!wordToolsToggle);
  }


  return (
    <div className='sidebarButtonsArea'>
      <div className='sidebarMainButtons'>Araç Gümrük Vergi Hesaplama</div>
      <div className='sidebarMainButtons'>Motorsiklet Gümrük Vergi Hesaplama</div>
      <div className='sidebarMainButtons'>Kira Yardımı Hesaplama</div>
      <div className='sidebarMainButtons'>Time Dilation Calculator</div>
      <div className='sidebarMainButtons'>Investment Return Calculator</div>
      <div onClick={toggleConverters} className='sidebarMainButtons'>Unit Converters &#x25BC;</div>
      {
        converterToggle && (
          <>
            <div className='sidebarSideButtons'>Weight Converter</div>
            <div className='sidebarSideButtons'>Length Converter</div>
            <div className='sidebarSideButtons'>Temperature Converter</div>
            <div className='sidebarSideButtons'>Area Converter</div>
            <div className='sidebarSideButtons'>Volume Converter</div>
            <div className='sidebarSideButtons'>Time Converter</div>
          </>
        )
      }
      <div onClick={toggleWordTools} className='sidebarMainButtons'>Word Tools &#9660;</div>
      {
        wordToolsToggle && (
          <>
            <div className='sidebarSideButtons'>Character Counter</div>
            <div className='sidebarSideButtons'>Sentence Splitter</div>
            <div className='sidebarSideButtons'>Word Insulator</div>
          </>
        )
      }
    </div>
  )
}

export default SidebarNav