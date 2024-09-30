import React, {useState, useEffect} from 'react';
import axios from "axios";
import "../styles/Comment.css";

function CommentReply({commentId2, pageId3}) {
    const [name, setName] = useState("");
    const [text, setText] = useState("");

    const [commentTitle1, setCommentTitle1] = useState("İsim ve Soyisim");
    const [commentTitle2, setCommentTitle2] = useState("Yorum");
    const [commentTitle3, setCommentTitle3] = useState("Kaydet")

    useEffect(() => {
        if (Number(pageId3) > 9) {
            setCommentTitle1("Name and Surname");
            setCommentTitle2("Comment");
            setCommentTitle3("Save");
        }
    }, [pageId3])
    
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
                pageId3: Number(pageId3), 
                name,
                text,
                date,
                commentId: Number(commentId2)
            }
            try {
                const response = await axios.post("http://localhost:5000/serversavecommentreply", newComment)
                alert(response.data.message);
            } catch (error) {
                if (error.response && error.response.status === 429) {
                    alert("Yeni cevap için biraz bekleyiniz.");
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
                    <label htmlFor='name'>{commentTitle1}</label>
                    <input type='text' id='name' required maxLength={30} 
                        value={name}
                        onChange={ (e) => setName(e.target.value)} aria-label={commentTitle1} />
                </div>
                <div className="form-group">
                    <label htmlFor='text'>{commentTitle2}</label>
                    <textarea type='text' id='text' required maxLength={300}
                        value={text}
                        onChange={ (e) => setText(e.target.value)} aria-label={commentTitle2} > 
                    </textarea>
                </div>
                <button type='submit' aria-label={commentTitle3}>{commentTitle3}</button>
            </form>
        </div>
    )
}

export default CommentReply;
