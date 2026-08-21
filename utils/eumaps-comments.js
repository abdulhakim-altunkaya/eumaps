document.addEventListener('DOMContentLoaded', () => {
  const commentsRoot = document.getElementById('comments-root');

  if (!commentsRoot) {
    return;
  }

  const pageId = Number(commentsRoot.dataset.pageId);

  if (!pageId) {
    console.error('Comment page ID is missing.');
    return;
  }

  const isEnglish = pageId > 9;

  const labels = {
    name: isEnglish ? 'Name and Surname' : 'İsim ve Soyisim',
    comment: isEnglish ? 'Comment' : 'Yorum',
    save: isEnglish ? 'Save' : 'Kaydet',
    reply: isEnglish ? 'Reply' : 'Cevapla',
    cancel: isEnglish ? 'Cancel' : 'İptal',
    tooLong: isEnglish
      ? 'Name or comment is too long.'
      : 'İsim veya Yorum alanları çok uzun',
    tooShort: isEnglish
      ? 'Name or comment is too short.'
      : 'İsim veya yorum alanları çok kısa',
    empty: isEnglish
      ? 'Please fill in all fields.'
      : 'Bütün alanları doldurunuz',
    waitComment: isEnglish
      ? 'Please wait before posting another comment.'
      : 'Yeni yorum için biraz bekleyiniz.',
    waitReply: isEnglish
      ? 'Please wait before posting another reply.'
      : 'Yeni cevap için biraz bekleyiniz.',
    saveError: isEnglish
      ? 'There was an error saving your comment. Please try again later.'
      : 'Yorumunuzu kaydederken hata oluştu. Lütfen daha sonra tekrar deneyiniz.'
  };

  let comments = [];
  let repliedCommentId = null;

  const createMainCommentForm = () => {
    const container = document.createElement('div');
    container.className = 'comment-container';

    const form = document.createElement('form');
    form.className = 'comment-form';

    const nameGroup = document.createElement('div');
    nameGroup.className = 'form-group';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.required = true;
    nameInput.maxLength = 30;
    nameInput.placeholder = labels.name;
    nameInput.setAttribute('aria-label', labels.name);

    const textGroup = document.createElement('div');
    textGroup.className = 'form-group';

    const textarea = document.createElement('textarea');
    textarea.required = true;
    textarea.maxLength = 300;
    textarea.placeholder = labels.comment;
    textarea.setAttribute('aria-label', labels.comment);

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = labels.save;
    submitButton.setAttribute('aria-label', labels.save);

    nameGroup.appendChild(nameInput);
    textGroup.appendChild(textarea);

    form.appendChild(nameGroup);
    form.appendChild(textGroup);
    form.appendChild(submitButton);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const name = nameInput.value.trim();
      const text = textarea.value.trim();

      if (name.length > 30 || text.length > 300) {
        alert(labels.tooLong);
        return;
      }

      if (name.length < 5 || text.length < 5) {
        alert(labels.tooShort);
        return;
      }

      if (!name || !text) {
        alert(labels.empty);
        return;
      }

      const date = new Date().toLocaleDateString('en-GB');

      try {
        const response = await axios.post('https://www.eumaps.org/serversavecomment', {
          pageId,
          name,
          text,
          date
        });

        alert(response.data.message);

        nameInput.value = '';
        textarea.value = '';

        await getComments();
      } catch (error) {
        if (error.response?.status === 429) {
          alert(labels.waitComment);
        } else {
          alert(labels.saveError);
        }
      }
    });

    container.appendChild(form);

    return container;
  };

  const createReplyForm = (commentId) => {
    const container = document.createElement('div');
    container.className = 'commentReplyFormContainer';

    const form = document.createElement('form');
    form.className = 'commentReplyForm';

    const namePart = document.createElement('div');
    namePart.className = 'commentReplyFormParts';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.required = true;
    nameInput.maxLength = 30;
    nameInput.placeholder = labels.name;
    nameInput.setAttribute('aria-label', labels.name);

    const textPart = document.createElement('div');
    textPart.className = 'commentReplyFormParts';

    const textarea = document.createElement('textarea');
    textarea.required = true;
    textarea.maxLength = 300;
    textarea.placeholder = labels.comment;
    textarea.setAttribute('aria-label', labels.comment);

    const buttons = document.createElement('div');
    buttons.className = 'commentReplyFormButtonsDiv';

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = labels.save;
    saveButton.setAttribute('aria-label', labels.save);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = labels.cancel;
    cancelButton.setAttribute('aria-label', labels.cancel);

    cancelButton.addEventListener('click', () => {
      repliedCommentId = null;
      render();
    });

    namePart.appendChild(nameInput);
    textPart.appendChild(textarea);

    buttons.appendChild(saveButton);
    buttons.appendChild(cancelButton);

    form.appendChild(namePart);
    form.appendChild(textPart);
    form.appendChild(buttons);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const name = nameInput.value.trim();
      const text = textarea.value.trim();

      if (name.length > 30 || text.length > 300) {
        alert(labels.tooLong);
        return;
      }

      if (name.length < 5 || text.length < 5) {
        alert(labels.tooShort);
        return;
      }

      if (!name || !text) {
        alert(labels.empty);
        return;
      }

      const date = new Date().toLocaleDateString('en-GB');

      try {
        const response = await axios.post('https://www.eumaps.org/serversavecommentreply', {
          pageId3: pageId,
          name,
          text,
          date,
          commentId
        });

        alert(response.data.message);

        repliedCommentId = null;

        await getComments();
      } catch (error) {
        if (error.response?.status === 429) {
          alert(labels.waitReply);
        } else {
          alert(labels.saveError);
        }
      }
    });

    container.appendChild(form);

    return container;
  };

  const createCommentsList = () => {
    const mainComments = comments.filter(
      comment => comment.parent_id === null
    );

    if (!mainComments.length) {
      return null;
    }

    const list = document.createElement('div');
    list.className = 'comments-list';
    list.setAttribute('aria-label', 'List of comments');

    mainComments.forEach(comment => {
      const item = document.createElement('div');
      item.className = 'comment-item';

      const header = document.createElement('div');
      header.className = 'comment-header';

      const name = document.createElement('span');
      name.className = 'comment-name';
      name.textContent = comment.name;

      const date = document.createElement('span');
      date.className = 'comment-date';
      date.textContent = comment.date;

      header.appendChild(name);
      header.appendChild(date);

      const body = document.createElement('div');
      body.className = 'comment-body';

      const text = document.createElement('div');
      text.className = 'comment-text';
      text.textContent = comment.comment;

      body.appendChild(text);

      const replies = comments.filter(
        reply => Number(reply.parent_id) === Number(comment.id)
      );

      replies.forEach(reply => {
        const replyContainer = document.createElement('div');
        replyContainer.className = 'replyCommentContainer';

        const replyText = document.createElement('span');
        replyText.style.paddingTop = '10px';

        const replyName = document.createElement('strong');
        replyName.textContent = reply.name;

        replyText.appendChild(replyName);
        replyText.append(
          ` (${reply.date}): ${reply.comment}`
        );

        replyContainer.appendChild(replyText);
        body.appendChild(replyContainer);
      });

      const replyButton = document.createElement('button');
      replyButton.type = 'button';
      replyButton.className = 'replyCommentBtn';
      replyButton.textContent = labels.reply;
      replyButton.setAttribute('aria-label', labels.reply);

      replyButton.addEventListener('click', () => {
        repliedCommentId = Number(comment.id);
        render();
      });

      body.appendChild(replyButton);

      if (repliedCommentId === Number(comment.id)) {
        body.appendChild(createReplyForm(comment.id));
      }

      item.appendChild(header);
      item.appendChild(body);

      list.appendChild(item);
    });

    return list;
  };

  const render = () => {
    commentsRoot.innerHTML = '';

    if (repliedCommentId === null) {
      commentsRoot.appendChild(createMainCommentForm());
    }

    const commentsList = createCommentsList();

    if (commentsList) {
      commentsRoot.appendChild(commentsList);
    }
  };

  const getComments = async () => {
    try {
      const response = await axios.get(
        `https://www.eumaps.org/servergetcomments/${pageId}`
      );

      comments = Array.isArray(response.data)
        ? response.data
        : [];

      render();
    } catch (error) {
      console.error('Error fetching comments:', error.message);
      comments = [];
      render();
    }
  };

  getComments();
});