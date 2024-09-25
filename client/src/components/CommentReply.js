import React, {useState} from 'react';
import { useParams } from 'react-router-dom';
import axios from "axios";
import "../styles/Comment.css";

function CommentReply({commentId2}) {
    const { provinceId } = useParams();
    const [name, setName] = useState("");
    const [text, setText] = useState("");
    
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
                provinceId: Number(provinceId), 
                name,
                text,
                date,
                commentId: Number(commentId2)
            }
            try {
                const response = await axios.post("/serversavecommentreply", newComment)
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
                    <label htmlFor='name'>İsim ve Soyisim</label>
                    <input type='text' id='name' required placeholder='İsim ve Soyisim' maxLength={30} 
                        value={name}
                        onChange={ (e) => setName(e.target.value)} aria-label="İsim ve Soyisim" />
                </div>
                <div className="form-group">
                    <label htmlFor='text'>Yorum</label>
                    <textarea type='text' id='text' required placeholder='Yorum' maxLength={300}
                        value={text}
                        onChange={ (e) => setText(e.target.value)} aria-label="Yorum" > 
                    </textarea>
                </div>
                <button type='submit' aria-label="Yorumu Kaydet">Kaydet</button>
            </form>
        </div>
    )
}

export default CommentReply;
