export const objectsArray = [
    {id: "button1",
    css: 
    `
    /*<button class="button1">COPY ME</button>*/
    @import url('https://fonts.googleapis.com/css2?family=Days+One&display=swap');
    .button1{
      width: 150px;
      height: 55px;
      font-size: 20px;
      background-color: red;
      color: white;
      font-size: 25px;
      font-family: "Days One", sans-serif;
      border-radius: 7px;
      padding: 5px;
      user-select: none;
      cursor: pointer;
      transition-duration: 0.3s;
    }
    .button1:hover{
        background-color: rgb(171, 3, 3);
    }
    .button1:active {
        box-shadow: 0 3px #666;
        transform: translateY(2px);
    }`},

    {id: "button2",
    css: 
    `
    /*<button class="button2">COPY ME</button>*/
    @import url('https://fonts.googleapis.com/css2?family=Lobster&display=swap'); /*Lobster*/
    .button2 {
      width: 160px;
      height: 60px;
      background-color: inherit;
      padding: 15px 30px;
      user-select: none;
      border: none;
      border-radius:10px;
      cursor: pointer;
      font-size: 22px;
      letter-spacing: 2px;
      font-family: 'Lobster', cursive;
      transition-duration: 0.3s;
    }
    .button2:hover {
      background-color: #eee;
    }
    .button2:active {
        box-shadow: 0 3px #666;
        transform: translateY(3px);
    }`},


    {id: "button3",
    css: 
    `
    /*<button class="button3">COPY ME</button>*/
    @import url('https://fonts.googleapis.com/css2?family=Prosto+One&display=swap'); /*Prosto One*/
    .button3 {
      width: 160px;
      height: 60px;
      background-color: #eee;
      padding: 10px 18px;
      user-select: none;
      border: none;
      border-radius:10px;
      cursor: pointer;
      font-size: 22px;
      font-family: 'Prosto One', cursive;
      transition-duration: 0.3s;
    }
    .button3:hover {
      background-color: #353935;
        color: white
    }
    .button3:active {
        box-shadow: 0 3px #666;
        transform: translateY(2px);
    }`},


    {id: "button4",
    css: 
    `
    /*<button class="button4">COPY ME</button>*/
    @import url('https://fonts.googleapis.com/css2?family=Dosis:wght@500&display=swap'); /*Dosis*/
    .button4 {
      width: 140px;
      height: 60px;
      font-size: 20px;
      background-color: white;
      border-width: 10px;
      border-style: solid;
      font-family: 'Dosis', sans-serif;
      border-color: blue blue orange orange;
      cursor: pointer;
      transition-duration: 0.4s;
    }
    .button4:hover{
      border-color: orange orange blue blue;
        border-width: 13px;
    }
    .button4:active {
        box-shadow: 0 5px #666;
        transform: translateY(4px);
    }`},


    {id: "button5",
    css: 
    `
    /*<button class="button5">COPY ME</button>*/
    @import url('https://fonts.googleapis.com/css2?family=Andika&display=swap'); /*Andika*/
    .button5 {
      width: 140px;
      height: 60px;
      background-color: black;
      color: white;
      border-width: 10px;
      border-style: solid;
      font-family: 'Andika', sans-serif;
      border-color: red blue green yellow;
      font-weight: bold;
      font-size: 20px;
      cursor: pointer;
      transition-duration: 0.4s;
    }
    .button5:hover{
      border-color: yellow red blue green;
        border-width: 8px;
    }
    .button5:active {
        box-shadow: 0 5px #666;
        transform: translateY(4px);
    }`},

    {id: "button6",
    css: 
    `
    /*<button class="button6">COPY ME</button>*/
    @import url('https://fonts.googleapis.com/css2?family=Dosis:wght@500&display=swap'); /*Dosis*/
    .button6 {
      height: 40px;
      width: 140px;
      font-size: 20px;
      background-color: #242329;
      color: #fcfcfc;
      border: 2px whitesmoke solid;
      border-radius: 4px; 
      font-family: 'Dosis', sans-serif;
      transition-duration: 0.4s;
    }
    .button6:hover {
      font-weight: bolder;
      cursor: pointer;
      box-shadow: 0 0 .25rem rgba(0, 0, 0, 0.5), -.125rem -.125rem 1rem rgba(239, 71, 101, 0.5), .125rem .125rem 1rem rgba(255, 154, 90, 0.5);
    }`},
    {id: "button7",
    css: 
    `
    /*<button class="button7">COPY ME</button>*/
    @import url('https://fonts.googleapis.com/css2?family=Dosis:wght@500&display=swap'); /*Dosis*/
    .button7 {
      height: 40px;
      width: 140px;
      font-size: 20px;
      font-family: 'Dosis', sans-serif;
      background-color: aquamarine;
      padding: 4px;
      border-radius: 5px;
      cursor: pointer;
      transition-duration: 0.3s;
    }
    .button7:hover {
      background-color: lightseagreen;
      font-weight: bolder;
    }
    .button7:active {
      box-shadow: 0 2px #666;
      transform: translateY(2px);
      box-shadow: 0 0 .25rem rgba(0, 0, 0, 0.5), -.125rem -.125rem 1rem rgba(239, 71, 101, 0.5), .125rem .125rem 1rem rgba(255, 154, 90, 0.5);
    }`},
    {id: "button8",
    css: 
    `
    /*<button class="button4">COPY ME</button>*/
    .button8{
      display: inline-block;
      outline: 0;
      border: 0;
      cursor: pointer;
      transition: box-shadow 0.15s ease,transform 0.15s ease;
      will-change: box-shadow,transform;
      background: #FCFCFD;
      box-shadow: 0px 2px 4px rgb(45 35 66 / 40%), 0px 7px 13px -3px rgb(45 35 66 / 30%), inset 0px -3px 0px #d6d6e7;
      height: 33px;
      padding: 0 28px;
      font-size: 16px;
      border-radius: 6px;
      color: #36395a;
      transition: box-shadow 0.15s ease,transform 0.15s ease;
    }
    
    .button8:hover {
        box-shadow: 0px 4px 8px rgb(45 35 66 / 40%), 0px 7px 13px -3px rgb(45 35 66 / 30%), inset 0px -3px 0px #d6d6e7;
        transform: translateY(-2px);
    }
    .button8:active{
        box-shadow: inset 0px 3px 7px #d6d6e7;
        transform: translateY(2px);
    }`},
    {id: "button9",
    css: 
    `
    /*<input className="inputFields" />*/
    .inputFields {
      height: 27px;
      width: 130px;
      margin-left: 12px;
      border-radius: 5px;
    }
    .inputFields:focus {
      background-color: lightsalmon;
      color:black;
    }
    /* Chrome, Safari, Edge, Opera */
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    /* Firefox */
    input[type=number] {
      -moz-appearance: textfield;
    }`},
    {id: "button10",
    css:`
    @import url('https://fonts.googleapis.com/css2?family=Kanit&display=swap');
    .button10 {
      font-family: 'Kanit', sans-serif;
      background-color: #101820;
      border: 2px solid #FEE715;
      color: white;
      padding: 10px 20px;
      text-align: center;
      text-decoration: none;
      display: inline-block;
      font-size: 16px;
      border-radius: 5px;
      cursor: pointer;
      transition: background-color 0.3s ease, transform 0.2s ease, box-shadow 0.3s ease, border-color 0.3s ease;
    }
    .button10:hover {
      background-color: #0D141E;
      border-color: #FEE715;
      transform: scale(1.05);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      animation: glowing 1.5s infinite;
    }
    .button10:active {
      transform: scale(0.95);
    }
    .button10:focus {
      outline: none;
      box-shadow: 0 0 5px #FEE715, 0 0 10px #FEE715;
    }
    @keyframes glowing {
      0% { box-shadow: 0 0 5px rgba(254, 231, 21, 0.8); }
      50% { box-shadow: 0 0 20px rgba(254, 231, 21, 0.8); }
      100% { box-shadow: 0 0 5px rgba(254, 231, 21, 0.8); }
    } 
    `},
    {id: "button11",
      css:`
      @import url('https://fonts.googleapis.com/css2?family=Lobster&display=swap'); /*Lobster*/
      .button11 {
        font-family: "Lobster";
        font-size: 20px;
        width: 20%;
        background: #4822cc;
        border-radius: 4px;
        color: white;
        user-select: none;
        cursor: pointer;
      }
      .button11 {
        margin-left: 12px;
      }
      `},
  ]




