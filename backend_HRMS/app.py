from website import create_app


# app=create_app()

# if __name__ =='__main__':
#     #make debug false in production
#     app.run(debug=True)
app = create_app()

if __name__ == '__main__':
    # make debug false in production
    app.run(host='0.0.0.0', port=5000, debug=True)