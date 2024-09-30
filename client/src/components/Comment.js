import React, {useState, useEffect} from 'react';
import axios from "axios";
import "../styles/Comment.css";

function Comment({pageId}) {
    const [name, setName] = useState("");
    const [text, setText] = useState("");

    const [commentTitle1, setCommentTitle1] = useState("İsim ve Soyisim");
    const [commentTitle2, setCommentTitle2] = useState("Yorum");
    const [commentTitle3, setCommentTitle3] = useState("Kaydet")

    useEffect(() => {
        if (Number(pageId) > 9) {
            setCommentTitle1("Name and Surname");
            setCommentTitle2("Comment");
            setCommentTitle3("Save");
        }
    }, [pageId])
    


    
    const handleSubmit = async (e) => {
        if (name.length > 30 || text.length > 300) {
            alert("İsim veya Yorum alanları çok uzun");
            return;
        }
        if(name.length < 5 || text.length < 5) {
            alert("İsim veya yorum alanları çok kısa");
            return;
        }
        e.preventDefault();
        if (name && text) {
            const date = new Date().toLocaleDateString('en-GB');
            const newComment = {
                pageId,
                name,
                text,
                date
            } 
            try {
                const response = await axios.post("http://localhost:5000/serversavecomment", newComment)
                alert(response.data.message);
            } catch (error) {
                if (error.response && error.response.status === 429) {
                    alert("Yeni yorum için biraz bekleyiniz.");
                } else {
                    alert("Yorumunuzu kaydederken hata oluştu. Lütfen daha sonra tekrar deneyiniz.");
                } 
            } finally {
                setName("");
                setText("");
            }
        } else {
            alert("Bütün alanları doldurunuz");
        } 
    }
    return (
        <div className="comment-container">
            <form className="comment-form" onSubmit={handleSubmit}> 
                <div className="form-group">
                    {/* <label htmlFor='name'>{commentTitle1}</label> */}
                    <input type='text' id='name' required maxLength={30} 
                        value={name} placeholder={commentTitle1}
                        onChange={ (e) => setName(e.target.value)} aria-label="İsim ve Soyisim" />
                </div>
                <div className="form-group">
                    {/* <label htmlFor='text'>{commentTitle2}</label> */}
                    <textarea type='text' id='text' required maxLength={300}
                        value={text} placeholder={commentTitle2}
                        onChange={ (e) => setText(e.target.value)} aria-label="Yorum" > 
                    </textarea>
                </div>
                <button type='submit' aria-label={commentTitle3}>{commentTitle3}</button>
            </form>
        </div>
    )
}

export default Comment;
