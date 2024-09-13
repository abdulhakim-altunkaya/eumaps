import {BrowserRouter as Router, Routes, Route, Link} from "react-router-dom";
import Sidebar from "./components/Sidebar";
import MainArea from "./components/MainArea";


function App() {
  return (
    <div className="App">
      <Router>
        <Sidebar />
        <MainArea />
      </Router>
    </div>
  );
}

export default App;
