from website import create_app


# app=create_app()

# if __name__ =='__main__':
#     #make debug false in production
#     app.run(debug=True)
app = create_app()

if __name__ =='__main__':
    # use_reloader=False: create_app() runs heavy MySQL DDL at import; the werkzeug
    # reloader would import twice and deadlock on metadata locks.
    app.run(debug=True, use_reloader=False)
    