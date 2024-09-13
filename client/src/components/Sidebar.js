import React from 'react';
import SidebarLogo from "./SidebarLogo";
import SidebarNav from "./SidebarNav";

function Sidebar() {
  return (
    <div className='sidebarArea'>
      <SidebarLogo/>
      <SidebarNav/>
    </div>
  )
}

export default Sidebar