import React from 'react';
import logo from "../images/logo.png";
import {useNavigate} from "react-router-dom";

function SidebarLogo() {

  const navigate = useNavigate();


  return (
    <div className='sidebarLogoArea'>
      <img src={logo} onClick={() => navigate("/")}
        alt='Logo of the webpage. If you click on it, it will take to hompage'/>
    </div>
  )
}

export default SidebarLogo