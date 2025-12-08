from website import create_app


app=create_app()

if __name__ =='__main__':
    #make debug false in production
    app.run(debug=True)